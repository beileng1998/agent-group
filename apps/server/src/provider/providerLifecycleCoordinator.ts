import type { ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";

import { makeKeyedEffectLock } from "./keyedEffectLock.ts";

export interface ProviderLifecycleCoordinator {
  readonly run: <A, E, R>(
    threadId: ThreadId,
    operation: () => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

/** Serializes provider lifecycle mutations per thread without coupling unrelated sessions. */
export function makeProviderLifecycleCoordinator(): ProviderLifecycleCoordinator {
  const withThreadLock = makeKeyedEffectLock<ThreadId>();

  return {
    run: (threadId, operation) => withThreadLock(threadId, Effect.suspend(operation)),
  };
}
