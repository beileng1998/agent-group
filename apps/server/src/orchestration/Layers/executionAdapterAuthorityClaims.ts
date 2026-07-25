import type { ThreadId } from "@agent-group/contracts";

export interface ExecutionAdapterClaimRecord {
  readonly adapter: "structured" | "terminal";
  readonly createdAt: number;
  readonly holders: number;
  readonly leased: boolean;
  readonly turnStart: boolean;
}

const CLAIM_TTL_MS = 5 * 60 * 1_000;

export function pruneExecutionAdapterClaims(
  claims: Map<ThreadId, Map<string, ExecutionAdapterClaimRecord>>,
  now: number,
): Map<ThreadId, Map<string, ExecutionAdapterClaimRecord>> {
  let next = claims;
  for (const [threadId, byId] of claims) {
    const kept = new Map(
      [...byId].filter(
        ([, claim]) => claim.leased || now - claim.createdAt < CLAIM_TTL_MS,
      ),
    );
    if (kept.size === byId.size) continue;
    if (next === claims) next = new Map(claims);
    if (kept.size === 0) next.delete(threadId);
    else next.set(threadId, kept);
  }
  return next;
}
