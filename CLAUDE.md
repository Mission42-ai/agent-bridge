# Agent Bridge

Generic, provider-agnostic agent executor. Receives work requests via HTTP and/or Pusher, spawns AI agent instances, reports results via HTTP callbacks.

## Architecture

```
HTTP POST /execute ─┐
                    ├→ Queue (concurrency) → Bridge (orchestrate) → Workspace (setup) → Provider (run) → Callback (report)
Pusher Event ───────┘
```

Entry point: `src/index.ts` — boots config, providers, queue, then starts HTTP (always) and Pusher (optional).

## Module Structure

| Module | File | Responsibility |
|--------|------|---------------|
| Entry | `src/index.ts` | Unified entry point: env validation, boot sequence, starts transports |
| Queue | `src/queue.ts` | `createQueue(maxConcurrent)` factory — `submit()`, `getStatus()` |
| HTTP | `src/http.ts` | HTTP transport: `POST /execute` (Bearer auth, 202), `GET /health` |
| Pusher | `src/pusher.ts` | Pusher transport with legacy `normalizeRequest()` |
| Bridge | `src/bridge.ts` | Orchestrator: validate → workspace → provider.run() → callback |
| Workspace | `src/workspace.ts` | Git worktree lifecycle (bare clone, create, overlay inject, cleanup), tempdir support |
| Config | `src/config.ts` | Env-based config with 60s TTL cache |
| Callback | `src/callback.ts` | HTTP POST callback with 10s timeout |
| Logging | `src/logging.ts` | Human-readable event formatting |
| Types | `src/types.ts` | Shared types: ExecutionRequest, CallbackPayload, Workspace, AgentConfig |
| Providers | `src/providers/` | Provider abstraction — currently Claude Code via Agent SDK |
| Memory | `src/memory/` | Optional configurable-es memory integration (context injection + transcript ingestion) |

## Key Concepts

- **Dumb Pipe**: Bridge passes `workspace`, `agent`, and `metadata` through 1:1. No domain logic.
- **Dual Transport**: HTTP always active, Pusher optional (only when `PUSHER_APP_KEY` set)
- **Workspace Strategies**: `git` (worktree from bare clone), `tempdir` (ephemeral), `cwd` (no setup)
- **Overlay Injection**: Files from `BRIDGE_OVERLAYS_DIR/<repo-slug>/` copied into worktree before execution
- **Provider Interface**: `src/providers/types.ts` — implement `Provider.run(ctx)` for new LLM backends
- **Legacy Compat**: `normalizeRequest()` in pusher.ts converts old `repo`/`branch`/`sdkOptions` format (Pusher only)

## Development

```bash
npm ci                  # Install dependencies
npm run build           # Compile TypeScript
npm run dev             # Run with tsx (dev mode)
npm run start           # Run compiled output
npm run bridge:restart  # Rebuild + restart systemd service
npm run bridge:logs     # Tail service logs
```

## Configuration

All via environment variables — see `.env.example`. Key vars:

**HTTP Transport:**
- `BRIDGE_HTTP_PORT` (default `3099`), `BRIDGE_HTTP_HOST` (default `127.0.0.1`)
- `BRIDGE_HTTP_BEARER_TOKEN` — required in production
- `BRIDGE_HTTP_NO_AUTH` — set `true` to disable auth (dev only)

**Pusher Transport (optional):**
- `PUSHER_APP_KEY` — enables Pusher transport when set
- `PUSHER_CLUSTER`, `PUSHER_CHANNEL`, `PUSHER_EVENT`

**Bridge:**
- `BRIDGE_BASE_DIR`, `BRIDGE_OVERLAYS_DIR`, `BRIDGE_TIMEOUT`, `MAX_CONCURRENT`
- `BRIDGE_SYSTEM_PROMPT_SUFFIX` — text appended to every agent's system prompt
- `CES_*` — memory bridge integration (all 4 required to enable)
