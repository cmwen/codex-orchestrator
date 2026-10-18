# Orbit · Codex Orchestrator

One entry for local Codex work: send a message, let the Decisions API choose the workspace and execution model, and follow results and approvals in an installable PWA.

**App:** [cmwen.dev/codex-orchestrator](https://cmwen.dev/codex-orchestrator/)

## Stack

- **pnpm** manages dependencies with a frozen lockfile and a pinned package-manager version.
- **Vite+** serves and builds the React PWA. Its version and Vite core alias live in `pnpm-workspace.yaml`.
- **Biome** formats and checks source. Use `pnpm check` and `pnpm format`; Vite+'s bundled formatter is not used for project formatting.
- **Hono** serves the authenticated local HTTP API through its Node adapter. WebSocket events use `ws` on the same server.
- **Effect** collects workspace context concurrently, reads the Codex catalog, runs the two decision stages, propagates tagged errors, and interrupts routing when a task is stopped.
- **Lucide React** is an npm dependency bundled into the application. Fonts, icons, and scripts have no runtime CDN dependency.

Use Node 24 LTS (`.node-version` pins the tested runtime). Node 22.18+ is also supported; the exact supported engine ranges and package-manager version are in `package.json`.

## Run locally

Install Codex CLI and sign in with `codex login`. Start a local LiteLLM proxy that supports the OpenAI-format **`/v1/decisions`** route (documented in LiteLLM 1.104.2+ on the 1.104.x line and 1.105.0-rc.3+). Its decision-model alias must point at a decision-capable provider.

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
# Set your LiteLLM URL, decision-model alias, and optional proxy key.
pnpm bridge
```

Keep the companion terminal running. Open the hosted PWA, connect with the printed loopback URL and token, then add workspace folders. Alternatively, use **Scan for projects** in the add-workspace dialog to discover repositories under a parent folder and register the ones you want. Scanning alone does not register a project.

To run the frontend locally, use `pnpm dev` in another terminal.

## Single entry and routing

Send new tasks and follow-ups to the same authenticated endpoint:

```http
POST http://127.0.0.1:4317/api/messages
Authorization: Bearer <companion-token>
Content-Type: application/json

{"message":"Fix refund reconciliation"}
```

The response is HTTP 202 with a session `id`. A follow-up adds that ID:

```json
{"message":"Also cover partial refunds", "sessionId":"<session-id>"}
```

Neither request requires a workspace or model. Read the result with `GET /api/sessions/<session-id>`, or follow authenticated WebSocket snapshots at `/events`. The PWA uses this same entry point. Older `/api/sessions` and `/api/sessions/:id/message` routes remain compatible.

For each message, the local companion:

1. Refreshes context for registered workspace candidates and gets the installed Codex app-server model catalog.
2. Calls LiteLLM's **`POST /v1/decisions`** with a named workspace `choice` question and the scanned context.
3. Calls the same API with the selected workspace and a named execution `choice` question. Options pair actual Codex model IDs with their supported reasoning efforts.
4. Validates both choices, confidence values, and probability distributions. Each question includes a no-match option, so an unrelated workspace or unsuitable execution model is not forced. Refusals, unknown choices, invalid responses, and unavailable decision services fail before Codex work starts; there is no chat-completions fallback.
5. Starts or resumes the Codex thread with the chosen workspace as `cwd`, and starts its turn with the selected model and effort.

Follow-ups retain their session workspace and choose the execution model again. Start a new task to route elsewhere. Decisions API evidence shows selected choices, alternative probabilities, confidence, sources, and timing. The API returns typed answers rather than prose: the displayed summary is generated from those answers and is not a model-authored rationale or hidden reasoning.

## Workspace context and discovery

The companion reads files on its own computer, not through the browser. Only registered workspaces are routing candidates. Parent-folder discovery finds Git repositories and recognizable project manifests; you choose which discovered projects to register.

Context includes:

- Root and nested `README`, `AGENTS.md`, `ARCHITECTURE`, and `CONTRIBUTING` Markdown/text documents, matched without case sensitivity.
- Sanitized `package.json` summaries: name, description, workspaces, script names, and dependency names. Script commands and arbitrary manifest fields are omitted.
- A bounded list of source/document paths, repository kind, and locations of common project manifests, such as `pyproject.toml`, `Cargo.toml`, and `go.mod`.

The scan respects root and nested `.gitignore` rules, omits hidden files, sensitive filenames, dependency/generated folders, and skips symlinks. Documentation symlinks outside a registered root are rejected. The routing catalog supports at most 254 workspace candidates and 254 model/effort pairs per decision (one additional option is reserved for no match). It reads at most 12 KB per context file and 48 KB of document context per workspace, indexes at most 240 files, visits at most 2,000 directory entries, and traverses four directory levels. Parent discovery traverses three levels and returns at most 40 candidates. Bounds and skipped files mean this is an overview, not an exhaustive repository index. The workspace card shows indexed paths and context documents.

Context refreshes before dispatch. Raw source-file bodies are not automatically included. Workspace documents are routing evidence; the routing instructions explicitly treat their contents as untrusted data. Codex independently loads applicable workspace instructions during execution.

## LiteLLM configuration

For example, configure a decision-model alias:

```yaml
model_list:
  - model_name: router
    litellm_params:
      model: openai/gpt-6-luna
      api_key: os.environ/OPENAI_API_KEY
```

```sh
litellm --config litellm.yaml --port 4000
```

The local companion `.env` uses:

```dotenv
LITELLM_BASE_URL=http://127.0.0.1:4000/v1
DECISION_MODEL=router
LITELLM_API_KEY=
```

A compatible LiteLLM alias can target another decision provider. Provider keys stay in LiteLLM or `.env`; the browser only configures the loopback router URL and model alias. Local routing may use remote inference, depending on that provider. Codex execution uses your local Codex configuration and credentials.

**Upgrading from 0.1:** existing sessions and workspace registrations are retained. Replace any generic chat-model routing alias with a decision-capable alias and update LiteLLM as needed. The first version called `/chat/completions`; version 0.2 uses `/decisions` exclusively. Replace npm commands and `package-lock.json` with pnpm and `pnpm-lock.yaml`.

## Codex sessions and local data

The companion starts `codex app-server --listen stdio://`, using the installed CLI's authentication and persistent thread history. It is an independent app-server client; it does not attach to the desktop app's private server or import unrelated sessions. To use an existing loopback WebSocket app-server, set `CODEX_APP_SERVER_URL` and optional `CODEX_APP_SERVER_TOKEN`. `CODEX_BIN` selects another installed executable.

Sessions support streamed results, command/change activity, user-input questions, approvals, interruption, rename, archive/restore, and follow-ups. Execution uses workspace-write sandboxing with on-request approvals reviewed by the user. Unsupported permission/tool requests receive an explicit error and grant nothing. Text tasks are supported; attachments and interactive terminals are not implemented.

State lives in ignored `.orchestrator/` files with owner-only permissions. Pairing tokens stay in browser session storage; only the companion URL persists across browser sessions. The companion binds to IPv4 loopback and checks bearer tokens, hostnames, and allowed browser origins. WebSocket clients authenticate in their first message. No session data is placed in the service-worker cache.

## Install and deploy

Use a browser that allows an HTTPS PWA to contact loopback services, and allow local network access when prompted. Install through the browser menu or the app's install button when available. The app shell works offline after the first successful visit; execution and session retrieval require the local companion.

`127.0.0.1` refers to the browser's device. A phone cannot reach a laptop companion at this URL. This version provides no remote tunnel or HTTPS companion.

GitHub Pages hosts only the static frontend. `.github/workflows/pages.yml` installs the pinned pnpm version, restores its cache, installs with the frozen lockfile, runs Biome and integration tests, builds with Vite+, and deploys `dist`. Pages should use **GitHub Actions** as its source. For another Pages domain, add its exact origin to `ALLOWED_ORIGINS`; do not expose the companion to a network.

## Verification

```sh
pnpm check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:pwa
```

Integration tests cover the Hono API, typed Decisions requests, workspace discovery/context exclusions, selecting a different repository/model, follow-ups, interruption through Effect, approvals, streaming, and persistence. Browser tests use fixtures without spending inference credits. The PWA check verifies repository subpaths, manifest/icons, offline loading, and absence of external asset requests. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an existing Chromium binary. PNG icons are committed; regenerate with `node scripts/generate-icons.mjs` after editing the SVG.

References: [OpenAI Decisions API](https://developers.openai.com/api/docs/guides/decisions), [LiteLLM Decisions support](https://docs.litellm.ai/docs/decisions), [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Vite+](https://viteplus.dev/guide), [Hono](https://hono.dev/docs/getting-started/nodejs), [Effect](https://effect.website/), [Biome](https://biomejs.dev/).
