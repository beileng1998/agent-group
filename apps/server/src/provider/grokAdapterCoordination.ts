import { Deferred, Effect, Fiber } from "effect";

import type { GrokSessionContext } from "./grokAdapterSessionState.ts";

const GROK_RESUME_REPLAY_QUIET_MS = 200;
const GROK_RESUME_REPLAY_HARD_TIMEOUT_MS = 30_000;
export const GROK_COMPACT_ABANDON_QUIET_MS = 5_000;
const GROK_COMPACT_CANCEL_WAIT_MS = 10_000;
const GROK_COMPACT_OUTCOME_QUIET_MS = 200;
const GROK_COMPACT_OUTCOME_MAX_WAIT_MS = 2_000;
const GROK_TURN_SETTLE_DRAIN_MAX_WAIT_MS = 1_000;
const GROK_TURN_SETTLE_DRAIN_POLL_MS = 25;

// Keep the active turn open until updates already accepted by ACP have been handled.
export function waitForGrokQueuedTurnEventsDrained(ctx: GrokSessionContext) {
  return Effect.gen(function* () {
    const target = yield* ctx.acp.sessionUpdatesEnqueuedCount;
    const startedAt = Date.now();
    while (
      ctx.sessionUpdatesProcessed < target &&
      Date.now() - startedAt < GROK_TURN_SETTLE_DRAIN_MAX_WAIT_MS
    ) {
      yield* Effect.sleep(GROK_TURN_SETTLE_DRAIN_POLL_MS);
    }
  });
}

// Let the notification consumer apply queued failure details before compact settles.
export function settleGrokCompactionOutcome(ctx: GrokSessionContext) {
  return Effect.gen(function* () {
    yield* waitForGrokQueuedTurnEventsDrained(ctx);
    const startedAt = Date.now();
    while (true) {
      const now = Date.now();
      const lastActivityAt = Math.max(ctx.lastTurnActivityAt ?? 0, startedAt);
      if (
        now - lastActivityAt >= GROK_COMPACT_OUTCOME_QUIET_MS ||
        now - startedAt >= GROK_COMPACT_OUTCOME_MAX_WAIT_MS
      ) {
        return;
      }
      yield* Effect.sleep(50);
    }
  });
}

// Serialize a timed-out compact's cancellation and stale update quiet window.
export function waitForAbandonedGrokCompaction(ctx: GrokSessionContext) {
  return Effect.gen(function* () {
    const cancelFiber = ctx.compactionCancelFiber;
    if (cancelFiber !== undefined) {
      yield* Fiber.join(cancelFiber).pipe(
        Effect.ignoreCause(),
        Effect.timeoutOption(GROK_COMPACT_CANCEL_WAIT_MS),
      );
      ctx.compactionCancelFiber = undefined;
      if (ctx.compactionQuietUntil !== undefined) {
        ctx.compactionQuietUntil = Math.max(
          ctx.compactionQuietUntil,
          Date.now() + GROK_COMPACT_ABANDON_QUIET_MS,
        );
      }
    }
    const compactionQuietUntil = ctx.compactionQuietUntil;
    if (compactionQuietUntil !== undefined) {
      const waitMs = compactionQuietUntil - Date.now();
      if (waitMs > 0) yield* Effect.sleep(waitMs);
      ctx.compactionQuietUntil = undefined;
    }
  });
}

// Grok can replay old updates after load; suppress them until the stream is quiet.
export function settleGrokResumeReplayWhenQuiet(ctx: GrokSessionContext) {
  return Effect.gen(function* () {
    const ready = ctx.resumeReplayReady;
    if (ready === undefined) return;
    const startedAt = Date.now();
    ctx.resumeReplayLastSuppressedAt = startedAt;
    while (ctx.resumeReplayReady !== undefined) {
      const now = Date.now();
      const lastSuppressedAt = ctx.resumeReplayLastSuppressedAt ?? startedAt;
      const quietForMs = now - lastSuppressedAt;
      const elapsedMs = now - startedAt;
      if (
        quietForMs >= GROK_RESUME_REPLAY_QUIET_MS ||
        elapsedMs >= GROK_RESUME_REPLAY_HARD_TIMEOUT_MS
      ) {
        const timedOut = elapsedMs >= GROK_RESUME_REPLAY_HARD_TIMEOUT_MS;
        ctx.resumeReplayReady = undefined;
        ctx.resumeReplayLastSuppressedAt = undefined;
        if (timedOut) {
          yield* Effect.logWarning("grok.acp.resume_replay_quiet_wait_timeout", {
            threadId: ctx.threadId,
            elapsedMs,
          });
        }
        yield* Deferred.succeed(ready, undefined);
        return;
      }
      yield* Effect.sleep(Math.min(GROK_RESUME_REPLAY_QUIET_MS - quietForMs, 50));
    }
    yield* Deferred.succeed(ready, undefined);
  });
}
