# Agent Bridge

Generic, provider-agnostic agent executor. Receives work requests via Pusher, spawns AI agent instances, reports results via HTTP callbacks.

## Architecture

```
Pusher Event → Transport (queue) → Bridge (orchestrate) → Workspace (setup) → Provider (run) → Callback (report)
```

## Module Structure

| Module | File | Responsibility |
|--------|------|---------------|
| Transport | `src/transport.ts` | Pusher listener, request normalization, concurrency queue (max `MAX_CONCURRENT`) |
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
- **Workspace Strategies**: `git` (worktree from bare clone), `tempdir` (ephemeral), `cwd` (no setup)
- **Overlay Injection**: Files from `BRIDGE_OVERLAYS_DIR/<repo-slug>/` copied into worktree before execution
- **Provider Interface**: `src/providers/types.ts` — implement `Provider.run(ctx)` for new LLM backends
- **Legacy Compat**: `normalizeRequest()` in transport.ts converts old `repo`/`branch`/`sdkOptions` format

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
- `PUSHER_APP_KEY` (required), `PUSHER_CLUSTER`, `PUSHER_CHANNEL`, `PUSHER_EVENT`
- `BRIDGE_BASE_DIR`, `BRIDGE_OVERLAYS_DIR`, `BRIDGE_TIMEOUT`, `MAX_CONCURRENT`
- `BRIDGE_SYSTEM_PROMPT_SUFFIX` — text appended to every agent's system prompt
- `CES_*` — memory bridge integration (all 4 required to enable)
