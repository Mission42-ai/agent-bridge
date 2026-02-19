import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { BridgeConfig } from "./config.js";
import type { Queue } from "./queue.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 1_048_576; // 1 MB
const VALID_WORKSPACE_TYPES = new Set(["git", "tempdir"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function securityHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Type", "application/json");
}

function json(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  securityHeaders(res);
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function verifyBearerToken(req: IncomingMessage, expected: string): boolean {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return false;

  const token = auth.slice(7);
  if (token.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

// ---------------------------------------------------------------------------
// HTTP Transport
// ---------------------------------------------------------------------------

export function startHttpTransport(config: BridgeConfig, queue: Queue): void {
  const port = config.httpPort;
  const host = config.httpHost;
  const bearerToken = config.httpBearerToken;
  const noAuth = config.httpNoAuth;
  const startTime = Date.now();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "GET";

    // ── GET /health ────────────────────────────────────────────────────
    if (method === "GET" && url.pathname === "/health") {
      json(res, 200, {
        status: "ok",
        queue: queue.getStatus(),
        uptime: Math.round((Date.now() - startTime) / 1000),
      });
      return;
    }

    // ── POST /execute ──────────────────────────────────────────────────
    if (method === "POST" && url.pathname === "/execute") {
      // Auth check
      if (!noAuth) {
        if (!bearerToken || !verifyBearerToken(req, bearerToken)) {
          json(res, 401, { error: "Unauthorized" });
          return;
        }
      }

      // Read body
      let rawBody: string;
      try {
        rawBody = await readBody(req);
      } catch {
        json(res, 413, { error: "Request body too large" });
        return;
      }

      // Parse JSON
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(rawBody);
      } catch {
        json(res, 400, { error: "Invalid JSON" });
        return;
      }

      // Validate: prompt must be a non-empty string
      if (!data.prompt || typeof data.prompt !== "string" || data.prompt.trim() === "") {
        json(res, 400, { error: "Field 'prompt' is required and must be a non-empty string" });
        return;
      }

      // Validate: workspace.type (if set)
      if (data.workspace && typeof data.workspace === "object" && !Array.isArray(data.workspace)) {
        const ws = data.workspace as Record<string, unknown>;
        if (ws.type !== undefined && !VALID_WORKSPACE_TYPES.has(ws.type as string)) {
          json(res, 400, { error: `Invalid workspace.type: must be one of ${[...VALID_WORKSPACE_TYPES].join(", ")}` });
          return;
        }
      }

      // Build ExecutionRequest (no normalizeRequest — HTTP accepts the native format)
      const id = typeof data.id === "string" ? data.id : randomUUID();
      const request = {
        id,
        prompt: data.prompt as string,
        callbackUrl: typeof data.callbackUrl === "string" ? data.callbackUrl : undefined,
        workspace: data.workspace as import("./types.js").ExecutionRequest["workspace"],
        agent: data.agent as import("./types.js").ExecutionRequest["agent"],
        metadata: data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
          ? data.metadata as Record<string, unknown>
          : undefined,
      };

      console.log(`[HTTP] Accepted ${id} (prompt: ${request.prompt.length} chars)`);
      queue.submit(request);

      json(res, 202, { id, status: "accepted" });
      return;
    }

    // ── Fallback ───────────────────────────────────────────────────────
    json(res, 404, { error: "Not found" });
  });

  server.listen(port, host, () => {
    console.log(`[HTTP] Listening on http://${host}:${port}`);
    if (noAuth) {
      console.warn("[HTTP] WARNING: Running without authentication (BRIDGE_HTTP_NO_AUTH=true)");
    }
  });
}
