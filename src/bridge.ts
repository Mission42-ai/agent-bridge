import type { ExecutionRequest, CallbackPayload, GitWorkspace } from "./types.js";
import type { ProviderResult } from "./providers/types.js";
import { loadBridgeConfig } from "./config.js";
import { sendCallback } from "./callback.js";
import { setupWorkspace, loadMcpServers, verifyGitPush } from "./workspace.js";
import { getProvider } from "./providers/registry.js";

// ---------------------------------------------------------------------------
// Bridge Orchestrator — validate → workspace → provider.run() → callback
// ---------------------------------------------------------------------------

export async function executeRequest(request: ExecutionRequest): Promise<void> {
  const startMs = Date.now();
  const config = loadBridgeConfig();
  let cleanup: (() => Promise<void>) | undefined;
  let cwd = process.cwd();

  // Guard: reject empty prompts immediately
  if (!request.prompt || request.prompt.trim() === "") {
    const errorMsg = `Empty prompt received for request ${request.id}`;
    console.error(`[Bridge] ${errorMsg}`);
    if (request.callbackUrl) {
      await sendCallback(request.callbackUrl, buildErrorPayload(request, errorMsg, startMs));
    }
    return;
  }

  try {
    // Setup workspace (supports git and tempdir strategies)
    const workspaceResult = await setupWorkspace(request.workspace, config);
    cwd = workspaceResult.cwd;
    cleanup = workspaceResult.cleanup;

    // Merge MCP servers: overlay (from workspace) < request (from caller)
    const overlayMcp = loadMcpServers(cwd);
    const requestMcp = request.agent?.mcpServers ?? {};
    const mcpServers = { ...overlayMcp, ...requestMcp };

    // Resolve provider
    const providerName = request.agent?.provider ?? config.defaultProvider;
    const provider = getProvider(providerName);

    // Resolve timeout
    const timeout = request.agent?.limits?.timeoutMs ?? config.timeout;

    console.log(
      `[Bridge] Running ${provider.name} in ${cwd} (model: ${request.agent?.model ?? config.defaultModel ?? "opus"}, timeout: ${timeout}ms)`,
    );
    console.log(
      `[Bridge] Agent config: ${JSON.stringify({
        model: request.agent?.model,
        hasOutputFormat: !!request.agent?.outputFormat,
        maxTurns: request.agent?.limits?.maxTurns,
        maxBudgetUsd: request.agent?.limits?.maxBudgetUsd,
      })}`,
    );
    console.log(
      `[Bridge] Prompt: "${request.prompt.slice(0, 120)}${request.prompt.length > 120 ? "..." : ""}"`,
    );

    // Build provider context
    const abortController = new AbortController();
    const ctx = {
      cwd,
      prompt: request.prompt,
      agent: request.agent ?? {},
      mcpServers,
      signal: abortController.signal,
      executionId: request.id,
      memoryUserId: typeof request.metadata?.userId === "string"
        ? request.metadata.userId
        : undefined,
    };

    // Race: provider vs timeout
    const providerPromise = provider.run(ctx);
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Bridge timeout: agent exceeded ${timeout}ms (${Math.round(timeout / 60_000)}min) for request ${request.id}`)),
        timeout,
      );
    });

    let providerResult: ProviderResult;
    try {
      providerResult = await Promise.race([providerPromise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId!);
    }

    const durationMs = Date.now() - startMs;
    console.log(
      `[Bridge] Done: ${providerResult.status} | $${providerResult.usage.totalCostUsd.toFixed(4)} | ${providerResult.usage.numTurns} turns | ${Math.round(durationMs / 1000)}s`,
    );

    // Verify git push if the caller expects a branch push (opt-in via metadata)
    let pushVerificationFailed = false;
    let pushVerificationError = "";
    const gitWorkspace = request.workspace?.type === "git" ? request.workspace as GitWorkspace : undefined;
    if (
      gitWorkspace &&
      gitWorkspace.branch &&
      gitWorkspace.branch !== "main" &&
      request.metadata?.expectBranchPush === true
    ) {
      const verification = await verifyGitPush(cwd, gitWorkspace.branch);
      if (!verification.pushed) {
        pushVerificationFailed = true;
        pushVerificationError = `Git push verification failed: branch "${gitWorkspace.branch}" has unpushed changes: ${verification.unpushedCommits.join(", ")}`;
        console.error(`[Bridge] ${pushVerificationError}`);
      }
    }

    // Send callback
    if (request.callbackUrl) {
      const payload: CallbackPayload = {
        id: request.id,
        status: pushVerificationFailed ? "error" : "success",
        durationMs,
        totalCostUsd: providerResult.usage.totalCostUsd,
        inputTokens: providerResult.usage.inputTokens,
        outputTokens: providerResult.usage.outputTokens,
        numTurns: providerResult.usage.numTurns,
        result: providerResult.output,
        error: pushVerificationFailed ? pushVerificationError : undefined,
        metadata: request.metadata,
      };
      console.log(`[Callback] Payload:`, JSON.stringify({
        id: payload.id,
        status: payload.status,
        hasResult: !!payload.result,
        resultLength: payload.result?.length ?? 0,
        resultPreview: payload.result?.slice(0, 200),
        numTurns: payload.numTurns,
        totalCostUsd: payload.totalCostUsd,
        hasMetadata: !!payload.metadata,
        metadataKeys: payload.metadata ? Object.keys(payload.metadata) : [],
      }));
      await sendCallback(request.callbackUrl, payload);
    }
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Bridge] Error: ${errorMsg}`);

    if (request.callbackUrl) {
      await sendCallback(request.callbackUrl, buildErrorPayload(request, errorMsg, startMs));
    }
  } finally {
    await cleanup?.();
  }
}

function buildErrorPayload(
  request: ExecutionRequest,
  error: string,
  startMs: number,
): CallbackPayload {
  return {
    id: request.id,
    status: "error",
    durationMs: Date.now() - startMs,
    totalCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    numTurns: 0,
    error,
    metadata: request.metadata,
  };
}
