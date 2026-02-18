// ---------------------------------------------------------------------------
// Bridge v2 Protocol Types
// ---------------------------------------------------------------------------

// ── Workspace Strategies ─────────────────────────────────────────────────────

export interface GitWorkspace {
  type: "git";
  repo: string;
  branch?: string;
  overlays?: boolean;
}

export interface TempDirWorkspace {
  type: "tempdir";
  seedFiles?: Record<string, string>;
}

export type Workspace = GitWorkspace | TempDirWorkspace;

// ── Tools Configuration (provider-agnostic) ──────────────────────────────────

export type ToolsConfig =
  | { type: "code" }
  | { type: "explicit"; tools: string[] }
  | { type: "none" };

// ── MCP Server ───────────────────────────────────────────────────────────────

export type McpServerSpec =
  | { type: "http"; url: string; headers?: Record<string, string> }
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "sse"; url: string; headers?: Record<string, string> };

// ── Agent Configuration ──────────────────────────────────────────────────────

export interface AgentConfig {
  provider?: string;
  model?: string;
  systemPrompt?: string;
  tools?: ToolsConfig;
  mcpServers?: Record<string, McpServerSpec>;
  outputFormat?: { type: string; schema: object };
  limits?: {
    maxTurns?: number;
    maxBudgetUsd?: number;
    timeoutMs?: number;
  };
  disallowedTools?: string[];
  env?: Record<string, string>;
  providerConfig?: Record<string, unknown>;
}

// ── ExecutionRequest (Platform → Bridge) ─────────────────────────────────────

export interface ExecutionRequest {
  id: string;
  prompt: string;
  callbackUrl?: string;
  workspace?: Workspace;
  agent?: AgentConfig;
  metadata?: Record<string, unknown>;
}

// ── ExecutionResult (Bridge → Platform) ──────────────────────────────────────

export interface ExecutionResult {
  id: string;
  status: "success" | "error";
  durationMs: number;
  usage: {
    totalCostUsd: number;
    inputTokens: number;
    outputTokens: number;
    numTurns: number;
  };
  result?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ── Callback Payload (flat format — backward compatible) ─────────────────────

export interface CallbackPayload {
  id: string;
  status: "success" | "error";
  durationMs: number;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  numTurns: number;
  result?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ── Legacy Types (for normalizeRequest backward compatibility) ────────────────

export interface LegacySdkOptions {
  model?: string;
  permissionMode?: string;
  outputFormat?: { type: string; schema: object };
  maxTurns?: number;
  maxBudgetUsd?: number;
  maxThinkingTokens?: number;
  systemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  env?: Record<string, string>;
}
