import type { ThreadId } from "@agent-group/contracts";
import type { Effect } from "effect";

import { makeKeyedEffectLock } from "./keyedEffectLock.ts";

export interface ProviderBindingCoordinator {
  readonly withWriteLock: <A, E, R>(
    threadId: ThreadId,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly recordSettledTurn: (threadId: ThreadId, turnId: string) => void;
  readonly consumeSettledTurn: (threadId: ThreadId, turnId: string) => boolean;
}

/** Owns atomic binding writes and pre-write turn settlement markers. */
export function makeProviderBindingCoordinator(): ProviderBindingCoordinator {
  const recentlySettledTurns = new Map<ThreadId, Set<string>>();
  const maxSettledTurnsPerThread = 8;

  const recordSettledTurn = (threadId: ThreadId, turnId: string): void => {
    let turns = recentlySettledTurns.get(threadId);
    if (turns === undefined) {
      turns = new Set();
      recentlySettledTurns.set(threadId, turns);
    }
    turns.delete(turnId);
    turns.add(turnId);
    while (turns.size > maxSettledTurnsPerThread) {
      const oldest = turns.values().next().value;
      if (oldest === undefined) break;
      turns.delete(oldest);
    }
  };

  const consumeSettledTurn = (threadId: ThreadId, turnId: string): boolean => {
    const turns = recentlySettledTurns.get(threadId);
    if (turns === undefined || !turns.has(turnId)) return false;
    turns.delete(turnId);
    if (turns.size === 0) recentlySettledTurns.delete(threadId);
    return true;
  };

  return {
    withWriteLock: makeKeyedEffectLock<ThreadId>(),
    recordSettledTurn,
    consumeSettledTurn,
  };
}
