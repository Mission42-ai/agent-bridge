import type {
  RecordTurnsResponse,
  SessionListResponse,
  SessionDetailResponse,
  CloseSessionResponse,
  AssembledContextResponse,
  IngestTranscriptResponse,
} from "./types.js";

export class MemoryClientError extends Error {
  override readonly name = "MemoryClientError";

  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface MemoryClientOptions {
  baseUrl: string;
  tenantId: string;
  appId: string;
  apiKey: string;
  userId?: string;
  bufferSize?: number;
  flushIntervalMs?: number;
}

export interface TurnInput {
  turnId?: string;
  source: string;
  role: string;
  content: string;
  toolName?: string;
  toolArgs?: string;
  timestamp?: string;
  clientOrderKey?: string;
}

export class MemoryClient {
  private readonly baseUrl: string;
  private readonly tenantId: string;
  private readonly appId: string;
  private readonly apiKey: string;
  private readonly userId: string | undefined;

  constructor(options: MemoryClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.tenantId = options.tenantId;
    this.appId = options.appId;
    this.apiKey = options.apiKey;
    this.userId = options.userId;
  }

  session(sessionId: string): Session {
    return new Session(this, sessionId);
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}/api/memory/${this.tenantId}/${this.appId}${path}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = this.buildUrl(path);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.userId) {
      headers["X-User-Id"] = this.userId;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let errorBody: Record<string, unknown> | undefined;
      try {
        errorBody = (await response.json()) as Record<string, unknown>;
      } catch {
        // ignore
      }
      throw new MemoryClientError(
        response.status,
        (errorBody?.error as string) ?? `HTTP ${response.status}`,
        errorBody?.details,
      );
    }

    return (await response.json()) as T;
  }

  async listSessions(options?: {
    userId?: string;
    limit?: number;
    offset?: number;
  }): Promise<SessionListResponse> {
    const params = new URLSearchParams();
    if (options?.userId) params.set("userId", options.userId);
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.offset !== undefined) params.set("offset", String(options.offset));
    const qs = params.toString();
    return this.request<SessionListResponse>(
      "GET",
      `/sessions${qs ? `?${qs}` : ""}`,
    );
  }

  async getSession(sessionId: string): Promise<SessionDetailResponse> {
    return this.request<SessionDetailResponse>(
      "GET",
      `/sessions/${sessionId}`,
    );
  }

  async recordTurns(
    sessionId: string,
    turns: TurnInput[],
    options?: {
      userId?: string;
      clientType?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<RecordTurnsResponse> {
    const resolvedTurns = turns.map((t) => ({
      ...t,
      timestamp: t.timestamp ?? new Date().toISOString(),
    }));
    return this.request<RecordTurnsResponse>(
      "POST",
      `/sessions/${sessionId}/turns`,
      {
        turns: resolvedTurns,
        userId: options?.userId,
        clientType: options?.clientType,
        metadata: options?.metadata,
      },
    );
  }

  async closeSession(
    sessionId: string,
    reason?: string,
  ): Promise<CloseSessionResponse> {
    return this.request<CloseSessionResponse>(
      "POST",
      `/sessions/${sessionId}/close`,
      reason ? { reason } : {},
    );
  }

  async ingestTranscript(
    sessionId: string,
    transcript: string,
    options?: { userId?: string; clientType?: string; metadata?: Record<string, unknown> },
  ): Promise<IngestTranscriptResponse> {
    return this.request<IngestTranscriptResponse>(
      "POST",
      `/sessions/${sessionId}/transcript`,
      {
        transcript,
        userId: options?.userId,
        clientType: options?.clientType,
        metadata: options?.metadata,
      },
    );
  }

  async getContext(options?: {
    sessionId?: string;
    maxTurns?: number;
  }): Promise<AssembledContextResponse> {
    const params = new URLSearchParams();
    if (options?.sessionId) params.set("sessionId", options.sessionId);
    if (options?.maxTurns !== undefined) params.set("maxTurns", String(options.maxTurns));
    const qs = params.toString();
    return this.request<AssembledContextResponse>(
      "GET",
      `/context${qs ? `?${qs}` : ""}`,
    );
  }
}

export class Session {
  private readonly client: MemoryClient;
  private readonly sessionId: string;
  private buffer: TurnInput[] = [];
  private readonly bufferSize: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly flushIntervalMs: number;
  private closed = false;

  constructor(
    client: MemoryClient,
    sessionId: string,
    options?: { bufferSize?: number; flushIntervalMs?: number },
  ) {
    this.client = client;
    this.sessionId = sessionId;
    this.bufferSize = options?.bufferSize ?? 10;
    this.flushIntervalMs = options?.flushIntervalMs ?? 5000;
  }

  addTurn(turn: TurnInput): void {
    if (this.closed) {
      throw new MemoryClientError(400, "Session is closed, cannot add turns");
    }

    this.buffer.push({
      ...turn,
      timestamp: turn.timestamp ?? new Date().toISOString(),
    });

    if (this.flushTimer === null && this.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => {
        void this.flush();
      }, this.flushIntervalMs);
    }

    if (this.buffer.length >= this.bufferSize) {
      void this.flush();
    }
  }

  async flush(): Promise<RecordTurnsResponse | null> {
    if (this.buffer.length === 0) return null;

    const turns = this.buffer.splice(0);
    return this.client.recordTurns(this.sessionId, turns);
  }

  async close(reason?: string): Promise<CloseSessionResponse> {
    if (this.closed) {
      throw new MemoryClientError(400, "Session is already closed");
    }

    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush();
    this.closed = true;

    return this.client.closeSession(this.sessionId, reason);
  }

  async ingestTranscript(
    transcript: string,
    options?: { clientType?: string; metadata?: Record<string, unknown> },
  ): Promise<IngestTranscriptResponse> {
    return this.client.ingestTranscript(this.sessionId, transcript, options);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get pendingTurns(): number {
    return this.buffer.length;
  }
}
