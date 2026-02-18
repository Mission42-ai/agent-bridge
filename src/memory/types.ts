// Response types for the Memory API (subset of configurable-es/lib/memory/types.ts)

export interface RecordTurnsResponse {
  sessionId: string;
  recorded: number;
  deduplicated: number;
  sessionCreated: boolean;
}

export interface SessionListResponse {
  sessions: Record<string, unknown>[];
  count: number;
  totalCount: number;
  pagination: { limit: number; offset: number };
}

export interface SessionDetailResponse {
  session: Record<string, unknown>;
  turns: Record<string, unknown>[];
}

export interface CloseSessionResponse {
  sessionId: string;
  status: string;
}

export interface IngestTranscriptResponse {
  sessionId: string;
  recorded: number;
  sessionCreated: boolean;
  stats: {
    lineCount: number;
    entriesProcessed: number;
    typeCounts: Record<string, number>;
    sourceCounts: Record<string, number>;
  };
}

export interface AssembledContextResponse {
  sessionId: string | null;
  turns: Record<string, unknown>[];
  previousSessionSummary: string | null;
  memories: unknown[];
  agentIdentity: unknown | null;
  userProfile: unknown | null;
}
