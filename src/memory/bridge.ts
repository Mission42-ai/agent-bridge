import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { MemoryClient, type Session } from "./client.js";
import type {
  HookCallback,
  StopHookInput,
} from "@anthropic-ai/claude-agent-sdk";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface MemoryBridgeConfig {
  /** configurable-es deployment URL */
  memoryApiUrl: string;
  /** Tenant ID */
  tenantId: string;
  /** App ID registered in configurable-es */
  appId: string;
  /** API key with "memory" scope */
  apiKey: string;
  /** User identifier for memory sessions (default: "agent-bridge") */
  userId?: string;
  /** Max turns to inject as context (default: 50) */
  maxContextTurns?: number;
}

// ---------------------------------------------------------------------------
// MemoryBridge — glue between Claude Agent SDK hooks and Memory API
// ---------------------------------------------------------------------------

export class MemoryBridge {
  private readonly client: MemoryClient;
  private session: Session | null = null;
  private readonly maxContextTurns: number;

  constructor(private readonly config: MemoryBridgeConfig) {
    this.client = new MemoryClient({
      baseUrl: config.memoryApiUrl,
      tenantId: config.tenantId,
      appId: config.appId,
      apiKey: config.apiKey,
      userId: config.userId,
    });
    this.maxContextTurns = config.maxContextTurns ?? 50;
  }

  /** Create a memory session. Call before query(). */
  startSession(sessionId?: string): void {
    this.session = this.client.session(sessionId ?? randomUUID());
  }

  /** Get SDK hooks object to merge into query options. */
  getHooks(): Record<string, { hooks: HookCallback[] }[]> {
    return {
      SessionStart: [{ hooks: [this.onSessionStart] }],
      Stop: [{ hooks: [this.onStop] }],
    };
  }

  // -----------------------------------------------------------------------
  // Hook: SessionStart -> inject prior context
  // -----------------------------------------------------------------------

  private onSessionStart: HookCallback = async () => {
    try {
      const ctx = await this.client.getContext({
        maxTurns: this.maxContextTurns,
      });

      if (ctx.turns.length === 0) return {};

      const lines = ctx.turns.map(
        (t: Record<string, unknown>) => `[${t.role}] ${t.content}`,
      );
      const contextBlock = [
        "<prior-session-context>",
        `Session ${ctx.sessionId} — ${ctx.turns.length} prior turns:`,
        "",
        ...lines,
        "</prior-session-context>",
      ].join("\n");

      return {
        hookSpecificOutput: {
          hookEventName: "SessionStart" as const,
          additionalContext: contextBlock,
        },
      };
    } catch (err) {
      // Don't block the session if memory API is down
      console.error("[memory-bridge] Failed to fetch context:", err);
      return {};
    }
  };

  // -----------------------------------------------------------------------
  // Hook: Stop -> read transcript file, ingest, and close session
  // -----------------------------------------------------------------------

  private onStop: HookCallback = async (input) => {
    this.ensureSession();

    try {
      const stopInput = input as StopHookInput;
      const transcriptPath = stopInput.transcript_path;

      if (transcriptPath) {
        const transcript = readFileSync(transcriptPath, "utf-8");
        const result = await this.session!.ingestTranscript(transcript);
        console.log(
          `[memory-bridge] Ingested transcript: ${result.recorded} entries recorded (${result.stats.entriesProcessed} processed, ${result.stats.lineCount} lines)`,
        );
      } else {
        console.warn("[memory-bridge] No transcript_path in Stop hook input, skipping ingestion");
      }

      await this.session!.close("session_ended");
    } catch (err) {
      console.error("[memory-bridge] Failed to ingest transcript / close session:", err);
    }

    this.session = null;
    return {};
  };

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private ensureSession(): void {
    if (!this.session) {
      this.startSession();
    }
  }
}
