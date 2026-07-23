// FILE: agentGroupSessionReadinessCache.ts
// Purpose: Deduplicate and bound the lightweight Agent Group Session preparation gate.
// Layer: Web session readiness utility

export const MAX_CACHED_AGENT_GROUP_SESSION_READINESS = 8;

type ReadinessEntry =
  | { readonly status: "pending"; readonly promise: Promise<void>; lastAccessedAt: number }
  | { readonly status: "ready"; lastAccessedAt: number };

const readinessBySessionKey = new Map<string, ReadinessEntry>();

function evictReadyEntriesToCapacity(): void {
  const readyEntries = [...readinessBySessionKey.entries()]
    .filter(
      (entry): entry is [string, Extract<ReadinessEntry, { status: "ready" }>] =>
        entry[1].status === "ready",
    )
    .toSorted((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt);

  let readyEntryCount = readyEntries.length;
  for (const [sessionKey] of readyEntries) {
    if (readyEntryCount <= MAX_CACHED_AGENT_GROUP_SESSION_READINESS) return;
    readinessBySessionKey.delete(sessionKey);
    readyEntryCount -= 1;
  }
}

export function isAgentGroupSessionPrepared(sessionKey: string): boolean {
  return readinessBySessionKey.get(sessionKey)?.status === "ready";
}

export function markAgentGroupSessionPrepared(sessionKey: string): void {
  readinessBySessionKey.set(sessionKey, { status: "ready", lastAccessedAt: Date.now() });
  evictReadyEntriesToCapacity();
}

export function prepareAgentGroupSession(
  sessionKey: string,
  prepare: () => Promise<unknown>,
): Promise<void> {
  const existing = readinessBySessionKey.get(sessionKey);
  if (existing?.status === "ready") {
    existing.lastAccessedAt = Date.now();
    return Promise.resolve();
  }
  if (existing?.status === "pending") {
    existing.lastAccessedAt = Date.now();
    return existing.promise;
  }

  const promise = Promise.resolve()
    .then(prepare)
    .then(() => {
      const current = readinessBySessionKey.get(sessionKey);
      if (current?.status === "pending" && current.promise === promise) {
        readinessBySessionKey.set(sessionKey, { status: "ready", lastAccessedAt: Date.now() });
        evictReadyEntriesToCapacity();
      }
    })
    .catch((error: unknown) => {
      const current = readinessBySessionKey.get(sessionKey);
      if (current?.status === "pending" && current.promise === promise) {
        readinessBySessionKey.delete(sessionKey);
      }
      throw error;
    });

  readinessBySessionKey.set(sessionKey, {
    status: "pending",
    promise,
    lastAccessedAt: Date.now(),
  });
  return promise;
}

export function invalidateAgentGroupSessionReadiness(sessionKey: string): void {
  readinessBySessionKey.delete(sessionKey);
}

export function resetAgentGroupSessionReadinessCacheForTests(): void {
  readinessBySessionKey.clear();
}
