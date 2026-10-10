import http from 'node:http';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { describeWorkspace } from './workspaces.mjs';
import { decide } from './router.mjs';
const busy = s => ['routing', 'running', 'waiting'].includes(s.status);
const hash = value => createHash('sha256').update(value || '').digest();
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && timingSafeEqual(hash(a), hash(b));
export function localRouterUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('Use a loopback HTTP(S) LiteLLM URL, such as http://127.0.0.1:4000/v1.');
  return url.href.replace(/\/$/, '');
}
async function body(req) {
  let data = ''; for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 65536) throw new Error('Request too large.'); }
  try { return JSON.parse(data || '{}'); } catch { throw new Error('Invalid JSON request.'); }
}
export function createApp({ store, codex, token, origins, routerKey, fetchImpl }) {
  const state = store.data;
  const clients = new Set(); let persistTimer;
  const snapshot = () => ({ ...state, config: { routerUrl: state.config.routerUrl, decisionModel: state.config.decisionModel }, codexConnected: codex.ready });
  const broadcast = () => { const value = JSON.stringify({ type: 'state', state: snapshot() }); for (const client of clients) if (client.readyState === 1) client.send(value); };
  const commit = async () => { await store.save(); broadcast(); };
  const update = () => { broadcast(); clearTimeout(persistTimer); persistTimer = setTimeout(() => store.save().catch(error => console.error('Could not save local session:', error.message)), 250); };
  const sessionById = id => { const s = state.sessions.find(s => s.id === id); if (!s) throw new Error('Session not found.'); return s; };
  const sessionByThread = id => state.sessions.find(s => s.threadId === id);
  const clearApprovals = s => { s.approvals = []; };
  codex.on('disconnected', reason => {
    for (const s of state.sessions) s.loaded = false;
    for (const s of state.sessions.filter(busy)) { s.status = 'interrupted'; s.error = reason; clearApprovals(s); }
    update();
  });
  codex.on('notification', ({ method, params: p }) => {
    const s = sessionByThread(p?.threadId || p?.thread?.id); if (!s) return;
    s.updatedAt = new Date().toISOString();
    if (method === 'turn/started') { s.turnId = p.turn.id; s.status = 'running'; }
    if (method === 'item/agentMessage/delta') {
      let message = s.messages.find(m => m.id === p.itemId);
      if (!message) { message = { id: p.itemId, role: 'assistant', text: '', turnId: p.turnId }; s.messages.push(message); }
      message.text += p.delta;
    }
    if (method === 'item/started' || method === 'item/completed') {
      const item = p.item;
      if (item?.type === 'agentMessage' && method === 'item/completed') {
        let m = s.messages.find(m => m.id === item.id);
        if (!m) { m = { id: item.id, role: 'assistant', text: '', turnId: p.turnId }; s.messages.push(m); }
        m.text = item.text;
      } else if (item && !['userMessage', 'reasoning'].includes(item.type)) {
        const index = s.activity.findIndex(a => a.id === item.id);
        const record = { id: item.id, type: item.type, status: item.status || (method === 'item/started' ? 'inProgress' : 'completed'), command: item.command, text: item.text, changes: item.changes, output: item.aggregatedOutput?.slice(-12000) };
        if (index === -1) s.activity.push(record); else s.activity[index] = record;
      }
    }
    if (method === 'turn/diff/updated') s.diff = p.diff;
    if (method === 'serverRequest/resolved') {
      s.approvals = s.approvals.filter(a => a.id !== p.requestId);
      if (s.status === 'waiting' && !s.approvals.length) s.status = 'running';
    }
    if (method === 'error') s.error = p.error?.message || 'Codex reported an error.';
    if (method === 'turn/completed') { s.status = p.turn.status === 'completed' ? 'completed' : p.turn.status === 'interrupted' ? 'interrupted' : 'failed'; s.error = p.turn.error?.message || s.error; s.turnId = null; clearApprovals(s); }
    update();
  });
  codex.on('request', request => {
    const s = sessionByThread(request.params?.threadId);
    const supported = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/requestUserInput'];
    if (!s || !supported.includes(request.method)) { codex.reject(request.id, 'This client does not support this request. No permission was granted.'); return; }
    s.approvals.push({ id: request.id, method: request.method, params: request.params }); s.status = 'waiting'; update();
  });
  async function dispatch(s, message) {
    try {
      const registered = s.workspaceId ? state.workspaces.filter(w => w.id === s.workspaceId) : [...state.workspaces];
      const workspaces = await Promise.all(registered.map(w => describeWorkspace(w)));
      const models = await codex.models();
      const decision = await decide({ message, workspaces, models, config: { ...state.config, routerKey }, fixedWorkspace: s.workspaceId, history: s.messages.slice(0, -1), fetchImpl });
      if (s.status !== 'routing') return;
      const workspace = workspaces.find(w => w.id === decision.workspaceId);
      s.workspaceId = workspace.id; s.workspaceName = workspace.name; s.workspacePath = workspace.path;
      s.decisions.push({ ...decision, workspaceName: workspace.name, sources: workspace.documents.map(d => d.name) });
      await commit();
      if (s.threadId) {
        if (!s.loaded) await codex.request('thread/resume', { threadId: s.threadId, cwd: workspace.path, model: decision.model, approvalPolicy: 'on-request', sandbox: 'workspace-write', approvalsReviewer: 'user' });
      } else {
        const result = await codex.request('thread/start', { cwd: workspace.path, model: decision.model, approvalPolicy: 'on-request', sandbox: 'workspace-write', approvalsReviewer: 'user' });
        s.threadId = result.thread.id;
      }
      s.loaded = true;
      if (s.status !== 'routing') { await commit(); return; }
      s.status = 'running'; await commit();
      const result = await codex.request('turn/start', { threadId: s.threadId, input: [{ type: 'text', text: message }], model: decision.model, effort: decision.effort, cwd: workspace.path });
      if (busy(s)) s.turnId = result.turn.id;
      await commit();
    } catch (error) { s.status = 'failed'; s.error = error.message; s.turnId = null; clearApprovals(s); await commit(); }
  }
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const host = req.headers.host?.split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host)) { res.writeHead(403); res.end('Invalid host'); return; }
    if (origin && !origins.includes(origin)) { res.writeHead(403); res.end('Origin not allowed'); return; }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin'); res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
      res.setHeader('Access-Control-Allow-Private-Network', 'true'); res.writeHead(204); res.end(); return;
    }
    const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (!equal(req.headers.authorization, `Bearer ${token}`)) { reply(401, { error: 'Pair with the companion token from your local terminal.' }); return; }
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/api/state') return reply(200, snapshot());
      if (req.method === 'GET' && url.pathname === '/api/models') { const models = await codex.models(); broadcast(); return reply(200, models); }
      if (req.method === 'PATCH' && url.pathname === '/api/config') {
        const input = await body(req);
        if (typeof input.decisionModel !== 'string' || !input.decisionModel.trim() || input.decisionModel.length > 200) throw new Error('Enter a decision model name.');
        state.config = { routerUrl: localRouterUrl(input.routerUrl), decisionModel: input.decisionModel.trim() }; await commit(); return reply(200, snapshot());
      }
      if (req.method === 'POST' && url.pathname === '/api/workspaces') {
        const w = await describeWorkspace(await body(req));
        if (state.workspaces.some(existing => existing.path === w.path)) throw new Error('This workspace is already registered.');
        state.workspaces.push(w); await commit(); return reply(201, w);
      }
      const workspaceMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)(\/refresh)?$/);
      if (workspaceMatch) {
        const id = decodeURIComponent(workspaceMatch[1]); const i = state.workspaces.findIndex(w => w.id === id); if (i < 0) throw new Error('Workspace not found.');
        if (req.method === 'POST' && workspaceMatch[2]) { state.workspaces[i] = await describeWorkspace(state.workspaces[i]); await commit(); return reply(200, state.workspaces[i]); }
        if (req.method === 'DELETE' && !workspaceMatch[2]) {
          if (state.sessions.some(s => s.workspaceId === id && busy(s))) throw new Error('Stop active sessions before removing this workspace.');
          state.workspaces.splice(i, 1); await commit(); return reply(200, { ok: true });
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/sessions') {
        const input = await body(req); const message = String(input.message || '').trim(); if (!message || message.length > 16000) throw new Error('Enter a task of up to 16,000 characters.');
        if (!state.workspaces.length) throw new Error('Add a workspace first.');
        const now = new Date().toISOString();
        const s = { id: randomUUID(), title: message.slice(0, 70), status: 'routing', createdAt: now, updatedAt: now, archived: false, threadId: null, turnId: null, decisions: [], messages: [{ id: randomUUID(), role: 'user', text: message }], activity: [], approvals: [] };
        state.sessions.unshift(s); await commit(); reply(202, s); void dispatch(s, message); return;
      }
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(message|interrupt|approval))?$/);
      if (match) {
        const s = sessionById(decodeURIComponent(match[1])); const input = await body(req);
        if (req.method === 'PATCH' && !match[2]) {
          if (input.title !== undefined) { if (typeof input.title !== 'string' || !input.title.trim()) throw new Error('Enter a session title.'); s.title = input.title.trim().slice(0, 100); }
          if (input.archived !== undefined) { if (busy(s)) throw new Error('Stop this session before archiving it.'); s.archived = !!input.archived; }
          await commit(); return reply(200, s);
        }
        if (req.method === 'POST' && match[2] === 'message') {
          if (busy(s)) throw new Error('Wait for the current turn or stop it before sending a follow-up.');
          if (s.archived) throw new Error('Restore this session before continuing.');
          const message = String(input.message || '').trim(); if (!message || message.length > 16000) throw new Error('Enter a message of up to 16,000 characters.');
          s.status = 'routing'; s.error = null; s.messages.push({ id: randomUUID(), role: 'user', text: message }); await commit(); reply(202, s); void dispatch(s, message); return;
        }
        if (req.method === 'POST' && match[2] === 'interrupt') {
          if (s.status === 'routing') { s.status = 'interrupted'; await commit(); return reply(200, s); }
          if (!s.turnId) throw new Error('The turn is starting. Try stopping again in a moment.');
          await codex.request('turn/interrupt', { threadId: s.threadId, turnId: s.turnId }); return reply(200, { ok: true });
        }
        if (req.method === 'POST' && match[2] === 'approval') {
          const approval = s.approvals.find(a => a.id === input.id); if (!approval) throw new Error('This request has already been resolved.');
          if (approval.method === 'item/tool/requestUserInput') {
            const answers = {};
            for (const q of approval.params.questions) { const answer = input.answers?.[q.id]; if (typeof answer !== 'string' || !answer.trim() || answer.length > 4000) throw new Error('Answer every question.'); answers[q.id] = { answers: [answer] }; }
            codex.respond(approval.id, { answers });
          } else {
            if (!['accept', 'decline', 'cancel'].includes(input.decision)) throw new Error('Invalid approval decision.');
            const available = approval.params.availableDecisions;
            if (available && !available.includes(input.decision)) throw new Error('This approval decision is not available.');
            codex.respond(approval.id, { decision: input.decision });
          }
          s.approvals = s.approvals.filter(a => a.id !== approval.id); if (!s.approvals.length) s.status = 'running'; await commit(); return reply(200, { ok: true });
        }
      }
      reply(404, { error: 'Not found.' });
    } catch (error) { reply(400, { error: error.message }); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  server.on('upgrade', (req, socket, head) => {
    const host = req.headers.host?.split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host) || !origins.includes(req.headers.origin) || req.url !== '/events') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      const timer = setTimeout(() => ws.close(1008, 'Pairing required'), 5000);
      ws.once('message', data => {
        clearTimeout(timer); let auth; try { auth = JSON.parse(data.toString()); } catch { ws.close(1008); return; }
        if (!equal(auth.token, token)) { ws.close(1008, 'Invalid token'); return; }
        clients.add(ws); ws.send(JSON.stringify({ type: 'state', state: snapshot() })); ws.on('close', () => clients.delete(ws));
      });
      ws.on('error', () => clients.delete(ws)); ws.on('close', () => clearTimeout(timer));
    });
  });
  return { server, snapshot, async close() { clearTimeout(persistTimer); for (const client of clients) client.close(); wss.close(); codex.close(); await store.save(); await new Promise(resolve => server.close(resolve)); } };
}
