import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
export class Store {
  constructor(dir) {
    this.dir = dir;
    this.queue = Promise.resolve();
  }
  async load() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      this.data = JSON.parse(
        await readFile(path.join(this.dir, 'state.json'), 'utf8'),
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.data = { workspaces: [], sessions: [], config: {} };
    }
    for (const session of this.data.sessions) {
      if (['running', 'routing', 'waiting'].includes(session.status)) {
        session.status = 'interrupted';
        session.error =
          'Companion restarted. Send a follow-up to resume this Codex thread.';
      }
      session.approvals = [];
      session.turnId = null;
    }
    let token;
    try {
      token = (await readFile(path.join(this.dir, 'token'), 'utf8')).trim();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      token = randomBytes(32).toString('base64url');
      await writeFile(path.join(this.dir, 'token'), token, { mode: 0o600 });
    }
    return token;
  }
  save() {
    const snapshot = JSON.stringify(this.data);
    const operation = this.queue.then(async () => {
      const file = path.join(this.dir, 'state.json');
      await writeFile(`${file}.tmp`, snapshot, { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
