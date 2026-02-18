// ---------------------------------------------------------------------------
// Provider Interface — abstraction over LLM runtimes
// ---------------------------------------------------------------------------

import type { AgentConfig, McpServerSpec } from "../types.js";

export interface Provider {
  readonly name: string;
  run(ctx: ProviderContext): Promise<ProviderResult>;
}

export interface ProviderContext {
  cwd: string;
  prompt: string;
  agent: AgentConfig;
  mcpServers: Record<string, McpServerSpec | Record<string, unknown>>;
  signal: AbortSignal;
  onEvent?: (event: ProviderEvent) => void;

  // Bridge-level context passed to providers that need it
  executionId: string;
  memoryUserId?: string;
}

export interface ProviderEvent {
  type: "log" | "tool_use" | "result";
  message: string;
}

export interface ProviderResult {
  status: "success" | "error";
  output?: string;
  error?: string;
  usage: {
    totalCostUsd: number;
    inputTokens: number;
    outputTokens: number;
    numTurns: number;
  };
}
