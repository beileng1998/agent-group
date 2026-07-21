import { Deferred, Effect, Fiber } from "effect";

import { cancelDroidTurnAndWait } from "./acp/DroidTurnCancellation.ts";
import type { DroidSessionContext } from "./droidAdapterSessionState.ts";

const DROID_RESUME_REPLAY_QUIET_MS = 350;
const DROID_RESUME_REPLAY_HARD_TIMEOUT_MS = 30_000;
const DROID_TURN_SETTLE_DRAIN_MAX_WAIT_MS = 1_000;
const DROID_TURN_SETTLE_DRAIN_POLL_MS = 25;
const DROID_CANCEL_GRACE_MS = 5_000;

export function cancelDroidPromptWithGrace(
  ctx: DroidSessionContext,
  promptFiber: Fiber.Fiber<void, never> | undefined,
) {
  return Effect.gen(function* () {
    const result = yield* cancelDroidTurnAndWait({
      cancel: ctx.acp.cancel,
      promptFiber,
      graceMs: DROID_CANCEL_GRACE_MS,
    });
    if (result.cancelRequest !== "sent" || result.prompt === "timedOut") {
      yield* Effect.logWarning("droid.acp.cancel_escalated", {
        threadId: ctx.threadId,
        turnId: ctx.activeTurnId,
        cancelRequest: result.cancelRequest,
        prompt: result.prompt,
        ...(result.cancelFailure ? { reason: result.cancelFailure } : {}),
      });
    }
    return result;
  });
}

export function waitForDroidQueuedTurnEventsDrained(ctx: DroidSessionContext) {
  return Effect.gen(function* () {
    const target = yield* ctx.acp.sessionUpdatesEnqueuedCount;
    const startedAt = Date.now();
    while (
      ctx.sessionUpdatesProcessed < target &&
      Date.now() - startedAt < DROID_TURN_SETTLE_DRAIN_MAX_WAIT_MS
    ) {
      yield* Effect.sleep(DROID_TURN_SETTLE_DRAIN_POLL_MS);
    }
  });
}

export function settleDroidResumeReplayWhenQuiet(ctx: DroidSessionContext) {
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
        quietForMs >= DROID_RESUME_REPLAY_QUIET_MS ||
        elapsedMs >= DROID_RESUME_REPLAY_HARD_TIMEOUT_MS
      ) {
        const timedOut = elapsedMs >= DROID_RESUME_REPLAY_HARD_TIMEOUT_MS;
        ctx.resumeReplayReady = undefined;
        ctx.resumeReplayLastSuppressedAt = undefined;
        if (timedOut) {
          yield* Effect.logWarning("droid.acp.resume_replay_quiet_wait_timeout", {
            threadId: ctx.threadId,
            elapsedMs,
          });
        }
        yield* Deferred.succeed(ready, undefined);
        return;
      }
      yield* Effect.sleep(Math.min(DROID_RESUME_REPLAY_QUIET_MS - quietForMs, 50));
    }
    yield* Deferred.succeed(ready, undefined);
  });
}
