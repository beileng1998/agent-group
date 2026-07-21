import type { ProviderSession, ThreadId } from "@agent-group/contracts";
import { Effect, Semaphore } from "effect";

import type { ClaudeSessionContext } from "./claudeAdapterRuntime.ts";
import {
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  type ProviderAdapterError,
} from "./Errors.ts";

const PROVIDER = "claudeAgent" as const;

export function makeClaudeSessionRegistry() {
  const contexts = new Map<ThreadId, ClaudeSessionContext>();
  const lifecycleLocks = new Map<ThreadId, Semaphore.Semaphore>();

  const withLifecycleLock = <A, E, R>(
    threadId: ThreadId,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> => {
    let lock = lifecycleLocks.get(threadId);
    if (lock === undefined) {
      lock = Semaphore.makeUnsafe(1);
      lifecycleLocks.set(threadId, lock);
    }
    return lock.withPermits(1)(effect);
  };

  const requireSession = (
    threadId: ThreadId,
  ): Effect.Effect<ClaudeSessionContext, ProviderAdapterError> => {
    const context = contexts.get(threadId);
    if (!context) {
      return Effect.fail(
        new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId,
        }),
      );
    }
    if (context.stopped || context.session.status === "closed") {
      return Effect.fail(
        new ProviderAdapterSessionClosedError({
          provider: PROVIDER,
          threadId,
        }),
      );
    }
    return Effect.succeed(context);
  };

  const listSessions = (): Effect.Effect<ReadonlyArray<ProviderSession>> =>
    Effect.sync(() => Array.from(contexts.values(), ({ session }) => ({ ...session })));

  const hasSession = (threadId: ThreadId): Effect.Effect<boolean> =>
    Effect.sync(() => {
      const context = contexts.get(threadId);
      return context !== undefined && !context.stopped;
    });

  const removeIfCurrent = (context: ClaudeSessionContext): void => {
    if (contexts.get(context.session.threadId) === context) {
      contexts.delete(context.session.threadId);
    }
  };

  return {
    contexts: contexts as ReadonlyMap<ThreadId, ClaudeSessionContext>,
    get: (threadId: ThreadId) => contexts.get(threadId),
    hasSession,
    install: (threadId: ThreadId, context: ClaudeSessionContext) => {
      contexts.set(threadId, context);
    },
    listSessions,
    removeIfCurrent,
    requireSession,
    withLifecycleLock,
  };
}
