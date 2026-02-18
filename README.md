# Agent Bridge

Generic, provider-agnostic agent executor — receives work requests via Pusher, spawns AI agent instances (currently Claude Code via the Claude Agent SDK), and reports results via HTTP callbacks. Manages git worktrees, overlay injection, and concurrent execution.

## Quick Start (Docker)

```bash
# 1. Clone and build
git clone https://github.com/Mission42-ai/agent-bridge.git
cd agent-bridge
npm ci && npm run build

# 2. Configure
cp .env.example .env.local
# Edit .env.local — at minimum set PUSHER_APP_KEY and ANTHROPIC_API_KEY

# 3. Run
docker compose up -d
```

## Quick Start (Node.js)

```bash
# 1. Clone and build
git clone https://github.com/Mission42-ai/agent-bridge.git
cd agent-bridge
npm ci && npm run build

# 2. Configure
cp .env.example .env.local
# Edit .env.local

# 3. Run
node dist/transport.js
```

Requires Node.js >= 20 and `@anthropic-ai/claude-code` installed globally (`npm install -g @anthropic-ai/claude-code`).

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env.local` as a starting point.

### Required

| Variable | Description |
|----------|-------------|
| `PUSHER_APP_KEY` | Pusher app key for receiving work requests |
| `ANTHROPIC_API_KEY` | API key for Claude (required when using the default `claude-code` provider) |

### Pusher Transport

| Variable | Default | Description |
|----------|---------|-------------|
| `PUSHER_APP_KEY` | *(required)* | Pusher app key |
| `PUSHER_CLUSTER` | `eu` | Pusher cluster region |
| `PUSHER_CHANNEL` | `agent-bridge` | Channel to subscribe to |
| `PUSHER_EVENT` | `run` | Event name to listen for |

### Bridge Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_BASE_DIR` | `/tmp/agent-bridge` | Base directory for repos and worktrees |
| `BRIDGE_OVERLAYS_DIR` | `./overlays` | Directory containing overlay files per repo |
| `BRIDGE_TIMEOUT` | `1800000` (30 min) | Agent execution timeout in ms |
| `MAX_CONCURRENT` | `3` | Maximum parallel agent executions |
| `BRIDGE_DEFAULT_PROVIDER` | `claude-code` | Default agent provider |
| `BRIDGE_DEFAULT_MODEL` | *(unset)* | Default model for agents (e.g. `sonnet`) |
| `BRIDGE_SYSTEM_PROMPT_SUFFIX` | *(empty)* | Text appended to every agent's system prompt |

### Memory Bridge (Optional)

Integrates with a [configurable-es](https://github.com/Mission42-ai/configurable-es) instance for persistent agent memory.

| Variable | Default | Description |
|----------|---------|-------------|
| `CES_BASE_URL` | *(unset)* | Base URL of your configurable-es instance |
| `CES_TENANT_ID` | *(unset)* | Tenant ID |
| `CES_APP_ID` | *(unset)* | App ID for the memory aggregate |
| `CES_API_KEY` | *(unset)* | API key for authentication |
| `MEMORY_MAX_CONTEXT_TURNS` | `50` | Max conversation turns to include as context |

All four `CES_*` variables must be set to enable the memory bridge.

### Other

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | Token for cloning private GitHub repos |

## Architecture

```
Pusher Event → Transport (queue) → Bridge (orchestrate) → Workspace (setup) → Provider (run) → Callback (report)
```

### Modules

| Module | Responsibility |
|--------|---------------|
| `src/transport.ts` | Pusher listener, config validation, concurrency queue |
| `src/bridge.ts` | Workspace management, agent execution, callback handling |
| `src/workspace.ts` | Worktree lifecycle (clone, create, overlay, cleanup) |
| `src/config.ts` | Env-based configuration with TTL cache |
| `src/callback.ts` | HTTP callback handling |
| `src/logging.ts` | Lightweight event logging |
| `src/types.ts` | Shared types (ExecutionRequest, CallbackPayload, etc.) |
| `src/providers/` | Provider abstraction (currently: Claude Code via Agent SDK) |
| `src/memory/` | Optional: Memory Bridge integration (configurable-es) |

## Overlays

Overlays are files that get injected into agent worktrees before execution. They are useful for providing repository-specific configuration (e.g., `CLAUDE.md`, `.env.local`) without committing them to the target repo.

### Directory Structure

```
overlays/
  Mission42-ai--configurable-es/    # Overlays for this repo
    CLAUDE.md
    .env.local
  Mission42-ai--other-repo/
    .env.local
```

When an agent requests `workspace: { type: "git", repo: "Mission42-ai/configurable-es", overlays: true }`, the bridge copies everything from `overlays/Mission42-ai--configurable-es/` into the worktree root.

Mount the overlays directory as a volume in Docker:

```yaml
volumes:
  - ./overlays:/app/overlays:ro
```

## Transport: Pusher Setup

The bridge uses [Pusher](https://pusher.com) as its event transport.

1. Create a Pusher Channels app at [pusher.com](https://dashboard.pusher.com)
2. Note the **app key** and **cluster**
3. Set `PUSHER_APP_KEY` and `PUSHER_CLUSTER` in your `.env.local`
4. To trigger work, publish an event to the configured channel/event with a JSON payload

### Event Payload

```json
{
  "id": "optional-unique-id",
  "prompt": "Your task description for the agent",
  "callbackUrl": "https://your-api.com/callback",
  "workspace": {
    "type": "git",
    "repo": "owner/repo",
    "branch": "main",
    "overlays": true
  },
  "agent": {
    "model": "sonnet",
    "systemPrompt": "Optional system prompt",
    "limits": { "maxTurns": 10, "maxBudgetUsd": 1.0 }
  },
  "metadata": { "type": "my-task-type" }
}
```

Only `prompt` is required. All other fields are optional.

### Workspace Types

| Type | Description |
|------|-------------|
| `git` | Clones a repo into a worktree. Requires `repo` (e.g., `"owner/repo"`). Optional: `branch`, `overlays`. |
| `tempdir` | Creates a temporary directory. Optional: `seedFiles` (object of filename -> content). |
| `cwd` | No workspace setup — agent runs in the bridge's working directory. |

## Callback Integration

When `callbackUrl` is provided, the bridge POSTs the execution result:

```json
{
  "id": "execution-id",
  "status": "completed",
  "durationMs": 45000,
  "totalCostUsd": 0.12,
  "inputTokens": 15000,
  "outputTokens": 3000,
  "numTurns": 5,
  "result": "Agent's final output text",
  "metadata": { "type": "my-task-type" }
}
```

| Field | Description |
|-------|-------------|
| `id` | Execution ID (from request or auto-generated) |
| `status` | `completed` or `error` |
| `durationMs` | Wall-clock execution time |
| `totalCostUsd` | Estimated API cost |
| `inputTokens` / `outputTokens` | Token usage |
| `numTurns` | Number of agent turns (tool calls) |
| `result` | Agent's final text output (on success) |
| `error` | Error message (on failure) |
| `metadata` | Passed through from the request |

## Provider

The bridge currently supports **Claude Code** as its agent provider (via the [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/sdk)). The architecture is provider-agnostic — additional providers can be added by implementing the provider interface in `src/providers/`.

## Monitoring

### Docker

```bash
docker compose logs -f bridge
```

### systemd (bare metal)

```bash
journalctl --user -u agent-bridge -f
```

### Log Format

The bridge logs structured messages:

- `[Config]` — Startup warnings (missing optional env vars)
- `[Pusher]` — Transport events (connect, subscribe, receive)
- `[Queue]` — Concurrency management (enqueue, dequeue, execute)
- `[Workspace]` — Worktree creation, overlay injection, cleanup
- `[Agent]` — Agent execution start/complete
- `[Callback]` — HTTP callback results
