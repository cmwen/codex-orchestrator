# Orbit · Codex Orchestrator

An installable GitHub Pages PWA for workspace-aware local Codex sessions. Describe the outcome without choosing a project or model. A decision model on your local LiteLLM router reads registered workspace context, chooses a workspace and execution model, and explains the decision in the session.

**Hosted app:** https://cmwen.dev/codex-orchestrator/

## Run on your computer

Requirements: Node.js 22.12+, Codex CLI installed and signed in (`codex login`), and a local LiteLLM proxy with a chat-completions model alias that supports JSON output.

```sh
npm ci
cp .env.example .env
# Edit DECISION_MODEL and LITELLM_BASE_URL to match your router.
npm run bridge
```

Keep the terminal running. Open the hosted app, choose **Connect companion**, and enter the printed loopback URL and pairing token. Add your workspace folders in **Workspaces**. Paths refer to the companion computer. Only explicitly registered folders become routing candidates.

Send a task. Orbit shows the chosen workspace, model, reasoning effort, routing confidence, source files and short explanation. Follow Codex results, review commands and changes, answer approval requests, stop a turn, rename sessions, archive or restore them, and send follow-ups. Follow-ups retain their session workspace and let the decision model choose the model again. Start a new task to route to another workspace.

Root `README`, `README.md`, `README.txt`, and `AGENTS.md` names are matched without case sensitivity. Up to 12 KB per file is included as routing evidence. Context refreshes at every dispatch; workspace cards can refresh manually. Symlinks outside the workspace are rejected. Codex itself loads applicable agent instructions during execution.

## Local LiteLLM router

Use an existing LiteLLM proxy or start one with a configuration like:

```yaml
model_list:
  - model_name: router
    litellm_params:
      model: openai/<your-decision-model>
      api_key: os.environ/OPENAI_API_KEY
```

```sh
litellm --config litellm.yaml --port 4000
```

Configure the companion:

```dotenv
LITELLM_BASE_URL=http://127.0.0.1:4000/v1
DECISION_MODEL=router
# Set only if your LiteLLM proxy requires a key:
LITELLM_API_KEY=
```

The alias may point at any compatible provider served by your local LiteLLM router. Provider credentials stay in LiteLLM or the companion `.env`. The PWA settings can change the local router URL and decision model alias without publishing credentials. The router must support `response_format: {type: "json_object"}`. Its response is validated against registered workspace IDs, the app-server model catalog, supported reasoning efforts, and confidence bounds. Invalid decisions or unavailable routers fail visibly before execution. Catalog entries describe candidates; successful inference establishes actual account access.

## Architecture

```text
GitHub Pages PWA
  │ authenticated HTTP + WebSocket / loopback
  ▼
Local Orbit companion (127.0.0.1:4317)
  ├─ root README / AGENTS.md → LiteLLM → validated routing decision
  ├─ Codex app-server → threads, turns, results, approvals
  └─ .orchestrator/ → local session and workspace state
```

The companion starts `codex app-server --listen stdio://` and uses the documented JSON-RPC protocol. It is an independent client, rather than an attachment to the desktop app’s private server. Codex threads persist through the installed CLI. Orbit persists the threads it creates and resumes them after restarting the companion; it does not import unrelated desktop sessions.

To connect to an already running app-server WebSocket instead, set `CODEX_APP_SERVER_URL=ws://127.0.0.1:4500` and, when required, `CODEX_APP_SERVER_TOKEN`. The endpoint must be loopback. `CODEX_BIN` can point at another Codex executable. Protocol integration was checked against Codex CLI 0.162.1; it uses stable thread/turn methods plus experimental user-input capability.

Execution uses Codex's workspace-write sandbox and on-request approval policy, with the user as the approval reviewer. Command and file approvals are shown in the PWA; grants are for one request. User-input questions are supported. Unsupported permission/tool requests receive an explicit RPC error, granting nothing. This first version supports text tasks, not attachments or interactive terminals.

## Installation and offline use

Use a browser that permits an HTTPS page to contact loopback services, such as current desktop Chromium. Allow local network access when prompted. Use the browser’s **Install app** command, or Orbit’s install button when the browser exposes an install prompt. The manifest and service worker support repository subpaths and offline app-shell loading after the first successful visit. Offline mode cannot execute work or retrieve sessions without the companion. Session transcripts remain in local companion storage and are never placed in the service-worker cache.

`127.0.0.1` refers to the device running the browser. A phone cannot reach a companion running on your laptop using this URL. Browsers with stricter mixed-content or local-network rules may block the connection; this version does not provide a remote tunnel or HTTPS companion. The app makes that limitation visible by remaining disconnected.

## Connection and data

The companion binds only to IPv4 loopback. Requests require a bearer token and browser origins must appear in `ALLOWED_ORIGINS`. HTTP host checks reject unexpected hostnames. WebSocket tokens are sent in the first message, not query strings. Pairing tokens stay in browser session storage; only the companion URL persists across browser sessions. A generated token is retained locally in `.orchestrator/token`; set `BRIDGE_TOKEN` to supply your own. The `.orchestrator` directory is ignored by Git and stores workspace context and session results with owner-only file permissions.

Workspace text and the user task are sent to the model configured in LiteLLM. Local routing does not imply local inference: a LiteLLM alias may call a remote model provider. Codex also uses the provider configured in your local Codex installation.

For another GitHub Pages account, add its exact origin (for example `https://your-user.github.io`) to `ALLOWED_ORIGINS`. Origin configuration allows origins rather than URL paths. Do not expose the local service to a network or include tokens in public source.

## Development and verification

```sh
npm run dev
npm test
npm run build
# Browser tests (install Chromium first when needed):
npx playwright install chromium
npm run test:browser
```

The dev app uses port 5173; browser checks use 5187. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` optionally selects an existing Chromium binary. Browser fixtures simulate companion responses so UI checks do not spend inference credits. Integration tests exercise the actual HTTP companion with temporary directories, a mock router and mock Codex transport. PNG install icons are committed; regenerate them with `node scripts/generate-icons.mjs` if the SVG changes.

## GitHub Pages deployment

The included `.github/workflows/pages.yml` installs dependencies, runs integration tests, builds the PWA, and deploys `dist` using official Pages actions. In repository **Settings → Pages**, select **GitHub Actions** as the source. Push to `main` or run the workflow manually. `vite` uses relative asset paths and the build adds hashed assets to the service-worker precache. The hosted deployment contains only the static frontend; run the companion separately on your computer.

## References

- [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server)
- [LiteLLM proxy quick start](https://docs.litellm.ai/docs/proxy/quick_start)
- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
