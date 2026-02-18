import type { Provider } from "./types.js";
import type { BridgeConfig } from "../config.js";
import { ClaudeCodeProvider } from "./claude-code.js";

// ---------------------------------------------------------------------------
// Provider Registry — maps provider names to instances
// ---------------------------------------------------------------------------

const providers = new Map<string, Provider>();

export function initProviders(config: BridgeConfig): void {
  providers.clear();
  providers.set("claude-code", new ClaudeCodeProvider(config));
}

export function getProvider(name: string): Provider {
  const provider = providers.get(name);
  if (!provider) {
    const available = [...providers.keys()].join(", ");
    throw new Error(`Unknown provider "${name}". Available: ${available}`);
  }
  return provider;
}

export function listProviders(): string[] {
  return [...providers.keys()];
}
