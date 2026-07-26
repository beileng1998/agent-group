import type { ServerSettings, TerminalAgentCapabilitySnapshot } from "@agent-group/contracts";

import { terminalAgentExecutable } from "./terminalAgentDriverRegistry";
import type { ResolvedTerminalTarget } from "./terminalAgentRuntimeTypes";

const PROBE_CACHE_TTL_MS = 30_000;

interface CachedProbe {
  readonly expiresAt: number;
  readonly value: Promise<TerminalAgentCapabilitySnapshot>;
}

const probesBySpawner = new WeakMap<object, Map<string, CachedProbe>>();

function probeKey(target: ResolvedTerminalTarget, settings: ServerSettings): string {
  return JSON.stringify({
    provider: target.provider,
    executable: terminalAgentExecutable(settings, target.provider),
    codexHome: target.provider === "codex" ? settings.providers.codex.homePath : null,
    modelSelection: target.provider === "pi" ? target.modelSelection : null,
  });
}

export async function cacheTerminalAgentProbe(
  target: ResolvedTerminalTarget,
  settings: ServerSettings,
  spawner: object,
  load: () => Promise<TerminalAgentCapabilitySnapshot>,
): Promise<TerminalAgentCapabilitySnapshot> {
  const probes = probesBySpawner.get(spawner) ?? new Map<string, CachedProbe>();
  probesBySpawner.set(spawner, probes);
  const now = Date.now();
  for (const [key, cached] of probes) {
    if (cached.expiresAt <= now) probes.delete(key);
  }
  const key = probeKey(target, settings);
  const cached = probes.get(key);
  if (cached) return cached.value;

  const value = load();
  probes.set(key, { expiresAt: now + PROBE_CACHE_TTL_MS, value });
  try {
    return await value;
  } catch (cause) {
    if (probes.get(key)?.value === value) probes.delete(key);
    throw cause;
  }
}
