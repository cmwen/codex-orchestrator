import path from 'node:path';
import { createApp, localRouterUrl } from './app.mjs';
import { CodexClient } from './codex.mjs';
import { Store } from './store.mjs';

const store = new Store(path.resolve(process.env.DATA_DIR || '.orchestrator'));
const generatedToken = await store.load();
store.data.config.routerUrl ||= localRouterUrl(
  process.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000/v1',
);
store.data.config.decisionModel ||= process.env.DECISION_MODEL || 'router';
for (const session of store.data.sessions) session.loaded = false;
const token = process.env.BRIDGE_TOKEN || generatedToken;
const codex = new CodexClient({
  bin: process.env.CODEX_BIN,
  url: process.env.CODEX_APP_SERVER_URL,
  token: process.env.CODEX_APP_SERVER_TOKEN,
});
const origins = (
  process.env.ALLOWED_ORIGINS ||
  'http://127.0.0.1:5173,http://localhost:5173,https://cmwen.github.io,https://cmwen.dev,https://www.cmwen.dev'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const app = createApp({
  store,
  codex,
  token,
  origins,
  routerKey: process.env.LITELLM_API_KEY,
});
const port = Number(process.env.PORT || 4317);
app.server.listen(port, '127.0.0.1', () => {
  console.log(
    `\nOrbit companion: http://127.0.0.1:${port}\nPairing token: ${token}\nAllowed PWA origins: ${origins.join(', ')}\n\nKeep this terminal running. Open the PWA and pair in Settings.\n`,
  );
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
