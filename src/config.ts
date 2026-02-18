import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Environment variable cache with TTL
// ---------------------------------------------------------------------------

const ENV_CACHE_TTL = 60_000; // 60 seconds
const envCache = new Map<string, { value: string | undefined; expiresAt: number }>();

export function envCached(key: string, fallback?: string): string | undefined {
  const now = Date.now();
  const cached = envCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value ?? fallback;

  const value = process.env[key];
  envCache.set(key, { value, expiresAt: now + ENV_CACHE_TTL });
  return value ?? fallback;
}

export function envCachedNumber(key: string, fallback: number): number {
  const raw = envCached(key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Clear the env cache (useful for testing or forced refresh). */
export function clearEnvCache(): void {
  envCache.clear();
}

// ---------------------------------------------------------------------------
// Bridge configuration
// ---------------------------------------------------------------------------

export interface BridgeConfig {
  baseDir: string;
  reposDir: string;
  worktreesDir: string;
  overlaysDir: string;
  timeout: number;
  maxConcurrent: number;
  defaultProvider: string;
  defaultModel: string | undefined;
  systemPromptSuffix: string;
  nonInteractiveDisallowed: string[];
}

export function loadBridgeConfig(): BridgeConfig {
  const baseDir = envCached("BRIDGE_BASE_DIR", "/tmp/agent-bridge")!;

  return {
    baseDir,
    reposDir: join(baseDir, "repos"),
    worktreesDir: join(baseDir, "worktrees"),
    overlaysDir: resolve(
      envCached("BRIDGE_OVERLAYS_DIR", join(process.cwd(), ".overlays"))!,
    ),
    timeout: envCachedNumber("BRIDGE_TIMEOUT", 1_800_000), // 30 min
    maxConcurrent: envCachedNumber("MAX_CONCURRENT", 3),
    defaultProvider: envCached("BRIDGE_DEFAULT_PROVIDER", "claude-code")!,
    defaultModel: envCached("BRIDGE_DEFAULT_MODEL"),
    systemPromptSuffix: envCached("BRIDGE_SYSTEM_PROMPT_SUFFIX", "")!,
    nonInteractiveDisallowed: ["AskUserQuestion"],
  };
}

// ---------------------------------------------------------------------------
// Memory configuration (uses central CES_* env vars — enabled when all 4 set)
// ---------------------------------------------------------------------------

export interface MemoryConfig {
  memoryApiUrl: string;
  tenantId: string;
  appId: string;
  apiKey: string;
  userId?: string;
  maxContextTurns?: number;
}

export function getMemoryConfig(userId?: string): MemoryConfig | null {
  const baseUrl = envCached("CES_BASE_URL");
  const tenantId = envCached("CES_TENANT_ID");
  const appId = envCached("CES_APP_ID");
  const apiKey = envCached("CES_API_KEY");

  if (!baseUrl || !tenantId || !appId || !apiKey) return null;

  return {
    memoryApiUrl: baseUrl,
    tenantId,
    appId,
    apiKey,
    ...(userId ? { userId } : {}),
    maxContextTurns: envCachedNumber("MEMORY_MAX_CONTEXT_TURNS", 50),
  };
}
