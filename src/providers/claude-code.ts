import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Provider, ProviderContext, ProviderResult } from "./types.js";
import { formatEvent } from "../logging.js";
import { getMemoryConfig, type BridgeConfig } from "../config.js";
import { MemoryBridge } from "../memory/bridge.js";

// ---------------------------------------------------------------------------
// Claude Code Provider — wraps Claude Agent SDK
// ---------------------------------------------------------------------------

export class ClaudeCodeProvider implements Provider {
  readonly name = "claude-code";

  constructor(private readonly bridgeConfig: BridgeConfig) {}

  async run(ctx: ProviderContext): Promise<ProviderResult> {
    const agent = ctx.agent;

    const effectiveModel = agent.model ?? this.bridgeConfig.defaultModel ?? "opus";
    const effectivePermissionMode = (agent.providerConfig?.permissionMode as string) ?? "bypassPermissions";
    console.log(`[claude-code] Model: ${effectiveModel}, Permission mode: ${effectivePermissionMode}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: Record<string, any> = {
      cwd: ctx.cwd,
      model: effectiveModel,
      permissionMode: effectivePermissionMode,
      allowDangerouslySkipPermissions: effectivePermissionMode === "bypassPermissions",
      mcpServers: ctx.mcpServers,
    };

    // Output format
    if (agent.outputFormat) {
      options.outputFormat = agent.outputFormat;
      console.log(`[claude-code] outputFormat applied:`, JSON.stringify({
        type: agent.outputFormat.type,
        schemaKeys: Object.keys(agent.outputFormat.schema ?? {}),
      }));
    } else {
      console.log(`[claude-code] No outputFormat — agent runs without structured output`);
    }

    // Limits
    if (agent.limits?.maxTurns !== undefined) options.maxTurns = agent.limits.maxTurns;
    if (agent.limits?.maxBudgetUsd !== undefined) options.maxBudgetUsd = agent.limits.maxBudgetUsd;

    // Provider-specific options
    if (agent.providerConfig?.maxThinkingTokens !== undefined) {
      options.maxThinkingTokens = agent.providerConfig.maxThinkingTokens;
    }

    // ── Tools ──
    const toolsConfig = agent.tools ?? { type: "code" };

    if (toolsConfig.type === "code") {
      // Claude Code preset: full toolset, preset system prompt + append
      const appendParts: string[] = [];
      if (agent.systemPrompt) appendParts.push(agent.systemPrompt);
      if (this.bridgeConfig.systemPromptSuffix) appendParts.push(this.bridgeConfig.systemPromptSuffix);
      options.systemPrompt = {
        type: "preset",
        preset: "claude_code",
        append: appendParts.length > 0 ? appendParts.join("\n") : undefined,
      };
      options.settingSources = ["project"];
      console.log(`[claude-code] Tools: preset=claude_code, systemPrompt: preset + ${appendParts.join("\n").length} chars append`);
    } else if (toolsConfig.type === "explicit") {
      options.tools = toolsConfig.tools;
      // Raw mode: caller's prompt + suffix as plain string
      const parts: string[] = [];
      if (agent.systemPrompt) parts.push(agent.systemPrompt);
      if (this.bridgeConfig.systemPromptSuffix) parts.push(this.bridgeConfig.systemPromptSuffix);
      options.systemPrompt = parts.length > 0 ? parts.join("\n") : undefined;
      console.log(`[claude-code] Tools: explicit (${toolsConfig.tools.length} tools), systemPrompt: raw ${parts.join("\n").length} chars`);
    } else if (toolsConfig.type === "none") {
      options.tools = [];
      // Raw mode: caller's prompt + suffix as plain string
      const parts: string[] = [];
      if (agent.systemPrompt) parts.push(agent.systemPrompt);
      if (this.bridgeConfig.systemPromptSuffix) parts.push(this.bridgeConfig.systemPromptSuffix);
      options.systemPrompt = parts.length > 0 ? parts.join("\n") : undefined;
      console.log(`[claude-code] Tools: none (MCP-only), systemPrompt: raw ${parts.join("\n").length} chars`);
    }

    // allowedTools from legacy providerConfig (only in preset mode — explicit/none use tools directly)
    if (toolsConfig.type === "code" && agent.providerConfig?.allowedTools) {
      options.allowedTools = agent.providerConfig.allowedTools;
    }

    // Merge caller disallowedTools with Bridge non-interactive defaults
    const callerDisallowed = agent.disallowedTools ?? [];
    options.disallowedTools = [...new Set([
      ...this.bridgeConfig.nonInteractiveDisallowed,
      ...callerDisallowed,
    ])];
    if (agent.env) options.env = agent.env;

    // Wire in memory hooks if configured
    const memoryConfig = getMemoryConfig(ctx.memoryUserId);
    if (memoryConfig) {
      const memoryBridge = new MemoryBridge(memoryConfig);
      memoryBridge.startSession(ctx.executionId);
      options.hooks = memoryBridge.getHooks();
      console.log(`[claude-code] Memory bridge enabled (session: ${ctx.executionId}, userId: ${ctx.memoryUserId ?? "none"})`);
    }

    // Run agent
    let result: ProviderResult = {
      status: "success",
      usage: {
        totalCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        numTurns: 0,
      },
    };

    for await (const message of query({ prompt: ctx.prompt, options })) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = message as Record<string, any>;

      // Stream: log relevant events
      const line = formatEvent(msg);
      if (line) console.log(line);

      if (message.type === "result") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = message as Record<string, any>;
        result = {
          status: "success",
          usage: {
            totalCostUsd: r.total_cost_usd ?? 0,
            inputTokens: r.usage?.input_tokens ?? 0,
            outputTokens: r.usage?.output_tokens ?? 0,
            numTurns: r.num_turns ?? 0,
          },
        };
        if (r.structured_output) {
          result.output = JSON.stringify(r.structured_output);
        } else if (r.result && typeof r.result === "string") {
          result.output = r.result;
        }
      }
    }

    return result;
  }
}
