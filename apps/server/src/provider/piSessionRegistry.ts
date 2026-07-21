import { type ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";

import {
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
} from "./Errors.ts";
import { PROVIDER, type PiSessionContext } from "./piAdapterCore.ts";

export function makePiSessionRegistry(sessions: Map<ThreadId, PiSessionContext>) {
  const requireSession = Effect.fn("PiAdapter.requireSession")(function* (threadId: ThreadId) {
    const context = sessions.get(threadId);
    if (!context) {
      return yield* new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId });
    }
    if (context.stopped) {
      return yield* new ProviderAdapterSessionClosedError({ provider: PROVIDER, threadId });
    }
    return context;
  });

  const disposeSessionContext = async (context: PiSessionContext) => {
    context.unsubscribe?.();
    context.unsubscribe = undefined;
    for (const pending of Array.from(context.pendingUserInputs.values())) {
      pending.resolve({});
    }
    context.pendingUserInputs.clear();
    context.stopped = true;
    await context.runtime.dispose();
  };

  return { disposeSessionContext, requireSession };
}
