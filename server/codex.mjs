import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import WebSocket from 'ws';
export class CodexClient extends EventEmitter {
  pending = new Map();
  nextId = 1;
  ready = false;
  starting = null;
  constructor(options = {}) {
    super();
    this.options = options;
  }
  async connect() {
    if (this.ready) return;
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }
  async start() {
    if (this.options.url) {
      const url = new URL(this.options.url);
      if (
        !['ws:', 'wss:'].includes(url.protocol) ||
        !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      )
        throw new Error('Codex app-server must be on loopback.');
      const socket = new WebSocket(url, {
        headers: this.options.token
          ? { Authorization: `Bearer ${this.options.token}` }
          : {},
      });
      this.socket = socket;
      socket.on('message', (data) => this.receive(data.toString()));
      socket.on('close', () => this.disconnected('Codex connection closed.'));
      socket.on('error', () =>
        this.disconnected('Could not connect to Codex app-server.'),
      );
      await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      this.send = (value) => socket.send(JSON.stringify(value));
    } else {
      const child = spawn(
        this.options.bin || 'codex',
        ['app-server', '--listen', 'stdio://'],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      this.child = child;
      child.stdin.on('error', () =>
        this.disconnected('Codex input stream closed.'),
      );
      child.on('error', () =>
        this.disconnected(
          'Codex could not start. Install Codex CLI and sign in with codex login.',
        ),
      );
      child.on('exit', () => this.disconnected('Codex app-server exited.'));
      // Diagnostics go to the local terminal, never to the hosted UI.
      child.stderr.on('data', (data) => process.stderr.write(data));
      createInterface({ input: child.stdout }).on('line', (line) =>
        this.receive(line),
      );
      this.send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
    }
    try {
      await this.request('initialize', {
        clientInfo: {
          name: 'orbit_orchestrator',
          title: 'Orbit',
          version: '0.2.0',
        },
        capabilities: { experimentalApi: true },
      });
      this.send({ method: 'initialized', params: {} });
      this.ready = true;
    } catch (error) {
      this.close();
      throw error;
    }
  }
  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out.`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.method) {
      this.emit(message.id !== undefined ? 'request' : 'notification', message);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    message.error
      ? pending.reject(new Error(message.error.message))
      : pending.resolve(message.result);
  }
  respond(id, result) {
    this.send({ id, result });
  }
  reject(id, message) {
    this.send({ id, error: { code: -32601, message } });
  }
  disconnected(reason) {
    this.ready = false;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
    this.emit('disconnected', reason);
  }
  close() {
    this.socket?.close();
    this.child?.kill();
    this.ready = false;
  }
  async models() {
    await this.connect();
    const data = [];
    let cursor;
    do {
      const result = await this.request('model/list', { cursor, limit: 100 });
      data.push(...result.data);
      cursor = result.nextCursor;
    } while (cursor);
    return data.filter((m) => !m.hidden);
  }
}
