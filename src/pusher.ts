import PusherModule from "pusher-js";
const Pusher = PusherModule as unknown as typeof PusherModule.default;
import { randomUUID } from "node:crypto";
import type { ExecutionRequest, LegacySdkOptions } from "./types.js";
import type { Queue } from "./queue.js";

// ---------------------------------------------------------------------------
// Normalize incoming Pusher data to ExecutionRequest
// (Legacy compat — only relevant for Pusher transport)
// ---------------------------------------------------------------------------

function normalizeRequest(data: Record<string, unknown>): ExecutionRequest {
  const id = typeof data.id === "string" ? data.id : randomUUID();
  const prompt = data.prompt as string;
  const callbackUrl = typeof data.callbackUrl === "string" ? data.callbackUrl : undefined;
  const metadata = data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
    ? data.metadata as Record<string, unknown>
    : undefined;

  // New format: has workspace or agent fields
  if (data.workspace || data.agent) {
    return {
      id,
      prompt,
      callbackUrl,
      workspace: data.workspace as ExecutionRequest["workspace"],
      agent: data.agent as ExecutionRequest["agent"],
      metadata,
    };
  }

  // Legacy format: has repo, branch, sdkOptions
  const request: ExecutionRequest = { id, prompt, callbackUrl, metadata };

  const repo = typeof data.repo === "string" ? data.repo : undefined;
  const branch = typeof data.branch === "string" ? data.branch : undefined;
  if (repo) {
    request.workspace = { type: "git", repo, branch, overlays: true };
  }

  const rawSdkOptions = data.sdkOptions;
  if (rawSdkOptions && typeof rawSdkOptions === "object" && !Array.isArray(rawSdkOptions)) {
    const sdk = rawSdkOptions as LegacySdkOptions;
    request.agent = {};

    if (sdk.model) request.agent.model = sdk.model;
    if (sdk.systemPrompt) request.agent.systemPrompt = sdk.systemPrompt;
    if (sdk.outputFormat) request.agent.outputFormat = sdk.outputFormat;
    if (sdk.disallowedTools) request.agent.disallowedTools = sdk.disallowedTools;
    if (sdk.env) request.agent.env = sdk.env;

    // Limits
    const limits: NonNullable<ExecutionRequest["agent"]>["limits"] = {};
    if (sdk.maxTurns !== undefined) limits.maxTurns = sdk.maxTurns;
    if (sdk.maxBudgetUsd !== undefined) limits.maxBudgetUsd = sdk.maxBudgetUsd;
    if (Object.keys(limits).length > 0) request.agent.limits = limits;

    // Provider-specific config (Claude Code options)
    const providerConfig: Record<string, unknown> = {};
    if (sdk.permissionMode) providerConfig.permissionMode = sdk.permissionMode;
    if (sdk.maxThinkingTokens !== undefined) providerConfig.maxThinkingTokens = sdk.maxThinkingTokens;
    if (sdk.allowedTools) providerConfig.allowedTools = sdk.allowedTools;
    if (Object.keys(providerConfig).length > 0) request.agent.providerConfig = providerConfig;

    // Clean up empty agent
    if (Object.keys(request.agent).length === 0) delete request.agent;
  }

  return request;
}

// ---------------------------------------------------------------------------
// Pusher Transport
// ---------------------------------------------------------------------------

export function startPusherTransport(queue: Queue): void {
  const {
    PUSHER_APP_KEY,
    PUSHER_CLUSTER = "eu",
    PUSHER_CHANNEL = "agent-bridge",
    PUSHER_EVENT = "run",
  } = process.env;

  if (!PUSHER_APP_KEY) {
    throw new Error("PUSHER_APP_KEY is required for Pusher transport");
  }

  const pusher = new Pusher(PUSHER_APP_KEY, { cluster: PUSHER_CLUSTER });
  const channel = pusher.subscribe(PUSHER_CHANNEL);

  console.log(
    `[Pusher] Listening on "${PUSHER_CHANNEL}" for "${PUSHER_EVENT}"`,
  );

  channel.bind(PUSHER_EVENT, (data: Record<string, unknown>) => {
    const raw = JSON.stringify(data);
    console.log(`[Pusher] Received event (${raw.length} bytes):`);
    console.log(`[Pusher] Raw keys: ${Object.keys(data).join(", ")}`);
    console.log(`[Pusher] Raw data: ${raw.slice(0, 500)}${raw.length > 500 ? "..." : ""}`);

    if (!data.prompt || typeof data.prompt !== "string") {
      console.error("[Pusher] Event missing 'prompt' field, skipping.");
      return;
    }

    const request = normalizeRequest(data);

    console.log(`[Pusher] Parsed request:`, JSON.stringify({
      id: request.id,
      hasWorkspace: !!request.workspace,
      workspaceType: request.workspace?.type,
      hasCallbackUrl: !!request.callbackUrl,
      hasAgent: !!request.agent,
      agentSummary: request.agent ? {
        model: request.agent.model,
        provider: request.agent.provider,
        hasOutputFormat: !!request.agent.outputFormat,
      } : null,
      hasMetadata: !!request.metadata,
      metadataKeys: request.metadata ? Object.keys(request.metadata) : [],
      promptLength: request.prompt.length,
    }));

    queue.submit(request);
  });

  channel.bind("pusher:subscription_succeeded", () => {
    console.log(`[Pusher] Subscribed to "${PUSHER_CHANNEL}" successfully.`);
  });

  channel.bind("pusher:subscription_error", (err: unknown) => {
    console.error("[Pusher] Subscription error:", err);
  });
}
