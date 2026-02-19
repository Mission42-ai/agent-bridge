import "dotenv/config";
import { loadBridgeConfig } from "./config.js";
import { initProviders } from "./providers/registry.js";
import { createQueue } from "./queue.js";
import { startPusherTransport } from "./pusher.js";
import { startHttpTransport } from "./http.js";

// ---------------------------------------------------------------------------
// Validate environment
// ---------------------------------------------------------------------------

function validateEnv(): void {
  const provider = process.env.BRIDGE_DEFAULT_PROVIDER || "claude-code";
  if (provider === "claude-code" && !process.env.ANTHROPIC_API_KEY) {
    console.warn("[Config] ANTHROPIC_API_KEY not set — Claude Code provider may fail");
  }

  // HTTP auth: require bearer token unless explicitly opted out
  if (!process.env.BRIDGE_HTTP_BEARER_TOKEN && process.env.BRIDGE_HTTP_NO_AUTH !== "true") {
    console.error("BRIDGE_HTTP_BEARER_TOKEN is required. Set BRIDGE_HTTP_NO_AUTH=true to disable (dev only).");
    process.exit(1);
  }
}

validateEnv();

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const config = loadBridgeConfig();
initProviders(config);

const queue = createQueue(config.maxConcurrent);

// Pusher transport (optional — only when PUSHER_APP_KEY is set)
if (process.env.PUSHER_APP_KEY) {
  startPusherTransport(queue);
} else {
  console.log("[Pusher] PUSHER_APP_KEY not set — Pusher transport disabled");
}

// HTTP transport (always)
startHttpTransport(config, queue);

console.log(`[Bridge] Ready (max concurrent: ${config.maxConcurrent})`);
