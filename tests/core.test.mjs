import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.mjs';
import { decide, validateDecision } from '../server/router.mjs';
import { Store } from '../server/store.mjs';
import {
  describeWorkspace,
  discoverWorkspaces,
} from '../server/workspaces.mjs';

const model = {
  model: 'test-codex',
  description: 'Test coding model',
  supportedReasoningEfforts: [{ reasoningEffort: 'medium' }],
};
const decision = {
  workspaceId: 'w1',
  model: 'test-codex',
  effort: 'medium',
  confidence: 0.9,
  reason: 'This workspace owns the requested feature.',
};
test('routing rejects unknown paths, models, effort, confidence and cross-workspace follow-ups', () => {
  assert.deepEqual(
    validateDecision(decision, [{ id: 'w1' }], [model]),
    decision,
  );
  for (const override of [
    { workspaceId: '/tmp/other' },
    { model: 'invented' },
    { effort: 'ultra' },
    { confidence: 2 },
    { reason: '' },
  ])
    assert.throws(() =>
      validateDecision({ ...decision, ...override }, [{ id: 'w1' }], [model]),
    );
  assert.throws(() =>
    validateDecision(decision, [{ id: 'w1' }], [model], 'w2'),
  );
});
function decisionPayload(body, workspaceId = 'w1', executionIndex = 0) {
  const question = body.questions[0];
  assert.ok(
    question.choices.length >= 2 && question.choices.length <= 255,
    'Decisions API choice count must satisfy the documented contract',
  );
  const selected =
    question.name === 'workspace'
      ? workspaceId
      : question.choices[executionIndex].value;
  return {
    model: body.model,
    answers: [
      {
        type: 'choice',
        name: question.name,
        choice: selected,
        confidence: 0.9,
        probabilities: question.choices.map((choice) => ({
          value: choice.value,
          probability: choice.value === selected ? 1 : 0,
        })),
      },
    ],
  };
}
test('router uses two typed Decisions API calls with workspace context and supported execution choices', async () => {
  const sent = [];
  const args = {
    message: 'Fix the website',
    workspaces: [
      {
        id: 'w1',
        name: 'Website',
        path: '/tmp/site',
        documents: [{ name: 'AGENTS.md', text: 'Website project' }],
        files: ['src/page.tsx'],
      },
    ],
    models: [model],
    config: {
      routerUrl: 'http://127.0.0.1:4000/v1',
      decisionModel: 'router',
      routerKey: 'private-key',
    },
  };
  const result = await decide({
    ...args,
    fetchImpl: async (url, options) => {
      sent.push({ url, options });
      return {
        ok: true,
        json: async () => decisionPayload(JSON.parse(options.body)),
      };
    },
  });
  assert.equal(result.workspaceId, 'w1');
  assert.equal(result.model, 'test-codex');
  assert.equal(result.effort, 'medium');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, 'http://127.0.0.1:4000/v1/decisions');
  assert.match(sent[0].options.body, /Website project/);
  assert.match(sent[1].options.body, /selectedWorkspace/);
  assert.equal(sent[0].options.headers.Authorization, 'Bearer private-key');
  assert.equal(JSON.parse(sent[0].options.body).questions[0].type, 'choice');
  assert.equal(JSON.parse(sent[1].options.body).questions[0].name, 'execution');
  assert.equal(result.choices.length, 2);
  await assert.rejects(
    decide({
      ...args,
      fetchImpl: async () => ({
        ok: true,
        json: async () => {
          throw new Error('bad');
        },
      }),
    }),
    /invalid JSON/,
  );
  for (const bad of [
    { answers: [] },
    { answers: [{ type: 'refusal', name: 'workspace' }] },
    {
      answers: [
        {
          type: 'choice',
          name: 'workspace',
          choice: 'invented',
          confidence: 0.9,
          probabilities: [],
        },
      ],
    },
    {
      answers: [
        {
          type: 'choice',
          name: 'workspace',
          choice: 'w1',
          confidence: NaN,
          probabilities: [],
        },
      ],
    },
  ])
    await assert.rejects(
      decide({
        ...args,
        fetchImpl: async () => ({ ok: true, json: async () => bad }),
      }),
    );
  await assert.rejects(
    decide({ ...args, fetchImpl: async () => ({ ok: false, status: 404 }) }),
    /Decisions API returned HTTP 404/,
  );
});
test('workspace context is case-insensitive, bounded and prevents symlink escape', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orbit-workspace-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'readme.md'), 'Project README');
  await writeFile(path.join(root, 'agents.md'), 'x'.repeat(16000));
  const w = await describeWorkspace({ path: root });
  assert.equal(w.documents.length, 2);
  assert.equal(w.documents[0].text.length, 12000);
  await rm(path.join(root, 'agents.md'));
  await symlink('/etc/passwd', path.join(root, 'AGENTS.md'));
  await assert.rejects(describeWorkspace({ path: root }), /outside/);
  await assert.rejects(describeWorkspace({ path: 'relative' }), /absolute/);
});
class FakeCodex extends EventEmitter {
  ready = true;
  calls = [];
  replies = [];
  async models() {
    return [model];
  }
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: 'thread1' } };
    if (method === 'turn/start') return { turn: { id: 'turn1' } };
    return {};
  }
  respond(id, result) {
    this.replies.push({ id, result });
  }
  reject() {}
  close() {}
}
async function fixture(t, content) {
  const routerRequests = [];
  const dir = await mkdtemp(path.join(tmpdir(), 'orbit-app-'));
  const store = new Store(path.join(dir, 'data'));
  await store.load();
  const w = await describeWorkspace({ path: dir, id: 'w1' });
  store.data.workspaces = [w];
  store.data.config = {
    routerUrl: 'http://127.0.0.1:4000/v1',
    decisionModel: 'router',
  };
  const codex = new FakeCodex();
  const app = createApp({
    store,
    codex,
    token: 'test-token',
    origins: ['http://localhost:5173'],
    fetchImpl: async (url, options) => {
      const payload = JSON.parse(options.body);
      routerRequests.push({ url, payload });
      return {
        ok: true,
        json: async () =>
          content
            ? typeof content === 'function'
              ? content(payload)
              : JSON.parse(content)
            : decisionPayload(payload),
      };
    },
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const request = async (endpoint, method = 'GET', data, headers = {}) => {
    const response = await fetch(url + endpoint, {
      method,
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
        ...headers,
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return {
      status: response.status,
      data: response.status === 204 ? null : await response.json(),
    };
  };
  return { app, codex, store, request, routerRequests };
}
async function eventually(check) {
  for (let i = 0; i < 50; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Condition did not become true');
}
test('companion authenticates requests and checks browser origins', async (t) => {
  const { request } = await fixture(t);
  assert.equal(
    (await request('/api/state', 'GET', undefined, { Authorization: '' }))
      .status,
    401,
  );
  const result = await request('/api/state');
  assert.equal(result.status, 200);
  assert.equal(result.data.workspaces[0].id, 'w1');
  const denied = await fetch(
    'http://127.0.0.1:' +
      (await fixture(t)).app.server.address().port +
      '/api/state',
    { headers: { Origin: 'https://evil.example' } },
  );
  assert.equal(denied.status, 403);
  const preflight = await request('/api/state', 'OPTIONS', undefined, {
    Origin: 'http://localhost:5173',
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    (
      await request('/api/config', 'PATCH', {
        routerUrl: 'https://example.com',
        decisionModel: 'router',
      })
    ).status,
    400,
  );
});
test('sessions route, stream, request approvals, complete, archive and resume', async (t) => {
  const { request, store, codex } = await fixture(t);
  const created = await request('/api/messages', 'POST', {
    message: 'Build the website',
  });
  assert.equal(created.status, 202);
  const s = store.data.sessions[0];
  await eventually(() => s.turnId === 'turn1');
  assert.equal(s.decisions.length, 1);
  assert.equal((await request(`/api/sessions/${s.id}`)).status, 200);
  assert.equal(s.decisions[0].decisionApi, 'decisions');
  assert.equal(s.decisions[0].choices.length, 2);
  assert.equal(codex.calls[0].params.cwd, store.data.workspaces[0].path);
  assert.equal(codex.calls[0].params.sandbox, 'workspace-write');
  assert.equal(
    (
      await request(`/api/sessions/${s.id}/message`, 'POST', {
        message: 'More',
      })
    ).status,
    400,
  );
  codex.emit('notification', {
    method: 'item/agentMessage/delta',
    params: {
      threadId: 'thread1',
      turnId: 'turn1',
      itemId: 'a1',
      delta: 'Hello',
    },
  });
  codex.emit('notification', {
    method: 'item/agentMessage/delta',
    params: {
      threadId: 'thread1',
      turnId: 'turn1',
      itemId: 'a1',
      delta: ' world',
    },
  });
  assert.equal(s.messages.at(-1).text, 'Hello world');
  codex.emit('request', {
    id: 77,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: 'thread1', turnId: 'turn1', command: 'npm test' },
  });
  assert.equal(s.status, 'waiting');
  assert.equal(
    (
      await request(`/api/sessions/${s.id}/approval`, 'POST', {
        id: 77,
        decision: 'accept',
      })
    ).status,
    200,
  );
  assert.deepEqual(codex.replies[0], {
    id: 77,
    result: { decision: 'accept' },
  });
  codex.emit('notification', {
    method: 'turn/completed',
    params: { threadId: 'thread1', turn: { status: 'completed' } },
  });
  assert.equal(s.status, 'completed');
  await request(`/api/sessions/${s.id}`, 'PATCH', { archived: true });
  assert.equal(s.archived, true);
  assert.equal(
    (
      await request(`/api/sessions/${s.id}/message`, 'POST', {
        message: 'More',
      })
    ).status,
    400,
  );
  await request(`/api/sessions/${s.id}`, 'PATCH', {
    archived: false,
    title: 'Website',
  });
  assert.equal(s.title, 'Website');
  s.loaded = false;
  await request('/api/messages', 'POST', {
    sessionId: s.id,
    message: 'Improve it',
  });
  await eventually(() => s.decisions.length === 2 && s.turnId === 'turn1');
  assert.ok(codex.calls.some((c) => c.method === 'thread/resume'));
});
test('bad routing never starts Codex and a retry can recover', async (t) => {
  const { request, store, codex } = await fixture(t, '{bad');
  await request('/api/sessions', 'POST', { message: 'Task' });
  await eventually(() => store.data.sessions[0].status === 'failed');
  assert.equal(codex.calls.length, 0);
  assert.match(store.data.sessions[0].error, /invalid JSON/);
});
test('store persists sessions and marks active work interrupted on restart', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'orbit-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const first = new Store(dir);
  const token = await first.load();
  first.data.sessions.push({
    status: 'running',
    approvals: [{ id: 1 }],
    turnId: 'active',
  });
  await first.save();
  const second = new Store(dir);
  assert.equal(await second.load(), token);
  assert.equal(second.data.sessions[0].status, 'interrupted');
  assert.deepEqual(second.data.sessions[0].approvals, []);
  assert.equal(second.data.sessions[0].turnId, null);
});

test('local scanning discovers projects and includes nested context while respecting ignore rules and secrets', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orbit-discovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const folder of [
    'web/docs',
    'web/src',
    'web/node_modules/package',
    'web/private',
    'web/ignored',
    'api',
  ])
    await mkdir(path.join(root, folder), { recursive: true });
  await writeFile(
    path.join(root, 'web/package.json'),
    JSON.stringify({
      name: 'storefront',
      description: 'Checkout UI',
      scripts: { test: 'secret command' },
      dependencies: { react: 'latest' },
      secret: 'must-not-send',
    }),
  );
  await writeFile(
    path.join(root, 'web/docs/ARCHITECTURE.md'),
    'Checkout components and payment state.',
  );
  await writeFile(path.join(root, 'web/src/page.tsx'), 'private code body');
  await writeFile(path.join(root, 'web/.env'), 'API_KEY=must-not-send');
  await writeFile(path.join(root, 'web/.gitignore'), 'private/\nignored/\n');
  await writeFile(path.join(root, 'web/private/README.md'), 'private-doc');
  await writeFile(path.join(root, 'web/ignored/package.json'), '{}');
  await writeFile(
    path.join(root, 'web/node_modules/package/README.md'),
    'dependency-doc',
  );
  await writeFile(
    path.join(root, 'api/pyproject.toml'),
    '[project]\nname="api"',
  );
  const discovery = await discoverWorkspaces(root);
  assert.deepEqual(discovery.candidates.map((c) => c.name).sort(), [
    'api',
    'web',
  ]);
  const w = await describeWorkspace({ path: path.join(root, 'web') });
  assert.ok(w.files.includes('src/page.tsx'));
  assert.ok(w.documents.some((d) => d.name === 'docs/ARCHITECTURE.md'));
  assert.ok(w.repository.manifests.includes('package.json'));
  assert.match(JSON.stringify(w.documents), /storefront/);
  assert.match(JSON.stringify(w.documents), /react/);
  for (const text of [
    'must-not-send',
    'private-doc',
    'dependency-doc',
    'private code body',
    'secret command',
  ])
    assert.ok(!JSON.stringify(w).includes(text));
  assert.ok(
    !w.files.some(
      (file) =>
        file.includes('.env') ||
        file.includes('private/') ||
        file.includes('ignored/') ||
        file.includes('node_modules/'),
    ),
  );
  assert.ok(w.context.bytes <= 48000);
});
test('authenticated scan endpoint is read-only and registers nothing automatically', async (t) => {
  const { request, store } = await fixture(t);
  const root = store.data.workspaces[0].path;
  await mkdir(path.join(root, 'child'));
  await writeFile(path.join(root, 'child/package.json'), '{}');
  const result = await request('/api/workspaces/scan', 'POST', { path: root });
  assert.equal(result.status, 200);
  assert.equal(result.data.candidates[0].name, 'child');
  assert.equal(store.data.workspaces.length, 1);
  assert.equal(
    (await request('/api/workspaces/scan', 'POST', { path: 'relative' }))
      .status,
    400,
  );
});

test('single entry dispatches to the chosen repository and execution model, and pins follow-ups', async (t) => {
  const { store, codex, request, routerRequests } = await fixture(t, (body) =>
    decisionPayload(body, 'w2', 1),
  );
  const root = store.data.workspaces[0].path;
  const second = path.join(root, 'payments');
  await mkdir(path.join(second, 'docs'), { recursive: true });
  await writeFile(
    path.join(second, 'docs/ARCHITECTURE.md'),
    'This repository owns refunds and invoice reconciliation.',
  );
  const workspace = await describeWorkspace({
    id: 'w2',
    name: 'Payments',
    path: second,
  });
  store.data.workspaces.push(workspace);
  codex.models = async () => [
    model,
    {
      model: 'strong-codex',
      description: 'Complex debugging',
      supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
    },
  ];
  const created = await request('/api/messages', 'POST', {
    message: 'Fix refund reconciliation',
  });
  assert.equal(created.status, 202);
  const session = store.data.sessions[0];
  await eventually(() => session.turnId === 'turn1');
  const start = codex.calls.find((c) => c.method === 'thread/start');
  const turn = codex.calls.find((c) => c.method === 'turn/start');
  assert.equal(start.params.cwd, second);
  assert.equal(start.params.model, 'strong-codex');
  assert.equal(turn.params.cwd, second);
  assert.equal(turn.params.effort, 'high');
  assert.equal(turn.params.input[0].text, 'Fix refund reconciliation');
  assert.match(
    routerRequests[0].payload.input,
    /refunds and invoice reconciliation/,
  );
  assert.equal(routerRequests[0].url, 'http://127.0.0.1:4000/v1/decisions');
  codex.emit('notification', {
    method: 'turn/completed',
    params: { threadId: 'thread1', turn: { status: 'completed' } },
  });
  await request('/api/messages', 'POST', {
    sessionId: session.id,
    message: 'Also cover partial refunds',
  });
  await eventually(() => session.decisions.length === 2);
  assert.deepEqual(
    routerRequests[2].payload.questions[0].choices.map((c) => c.value),
    ['w2', '__no_workspace__'],
  );
  assert.match(routerRequests[2].payload.input, /Fix refund reconciliation/);
});

test('Effect interruption prevents a canceled decision from dispatching a Codex turn', async (t) => {
  let release;
  const blocker = new Promise((resolve) => {
    release = resolve;
  });
  const { request, store, codex, routerRequests } = await fixture(
    t,
    async (body) => {
      await blocker;
      return decisionPayload(body);
    },
  );
  const created = await request('/api/messages', 'POST', {
    message: 'Task to cancel',
  });
  await eventually(() => routerRequests.length === 1);
  await request(`/api/sessions/${created.data.id}/interrupt`, 'POST', {});
  release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(store.data.sessions[0].status, 'interrupted');
  assert.equal(codex.calls.length, 0);
});

test('no-match Decisions answers stop dispatch instead of forcing an unrelated workspace or model', async (t) => {
  const unmatched = await fixture(t, (body) =>
    decisionPayload(body, '__no_workspace__'),
  );
  await unmatched.request('/api/messages', 'POST', {
    message: 'An unrelated project',
  });
  await eventually(() => unmatched.store.data.sessions[0].status === 'failed');
  assert.match(
    unmatched.store.data.sessions[0].error,
    /No registered workspace matches/,
  );
  assert.equal(unmatched.codex.calls.length, 0);
  const noModel = await fixture(t, (body) =>
    decisionPayload(body, 'w1', body.questions[0].choices.length - 1),
  );
  await noModel.request('/api/messages', 'POST', {
    message: 'An unsupported task',
  });
  await eventually(() => noModel.store.data.sessions[0].status === 'failed');
  assert.match(
    noModel.store.data.sessions[0].error,
    /No available Codex execution model/,
  );
  assert.equal(noModel.codex.calls.length, 0);
});
