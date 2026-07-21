import {
  type EventId,
  type ProviderRuntimeEvent,
  RuntimeItemId,
  type ThreadId,
} from "@agent-group/contracts";
import { Cause, Deferred, Effect, Exit, Option } from "effect";

import { mapAcpToAdapterError } from "./acp/AcpAdapterSupport.ts";
import type { AcpThreadLock } from "./acp/AcpAdapterSessionSupport.ts";
import { resolveAcpTurnIdleTimeoutMs } from "./acp/AcpTurnIdleWatchdog.ts";
import {
  GROK_COMPACT_ABANDON_QUIET_MS,
  settleGrokCompactionOutcome,
  waitForAbandonedGrokCompaction,
} from "./grokAdapterCoordination.ts";
import type { GrokSessionContext } from "./grokAdapterSessionState.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "./Errors.ts";
import type { GrokAdapterShape } from "./Services/GrokAdapter.ts";

const PROVIDER = "grok" as const;
const GROK_COMPACT_PROMPT = "/compact";
const GROK_COMPACT_TIMEOUT_MS = resolveAcpTurnIdleTimeoutMs({
  envVar: "AGENT_GROUP_GROK_TURN_IDLE_TIMEOUT_MS",
  defaultMs: 600_000,
});
type EventStamp = { readonly eventId: EventId; readonly createdAt: string };

export function makeGrokCompaction(input: {
  readonly makeEventStamp: () => Effect.Effect<EventStamp>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly requireSession: (
    threadId: ThreadId,
  ) => Effect.Effect<GrokSessionContext, ProviderAdapterSessionNotFoundError>;
  readonly withThreadLock: AcpThreadLock;
}): NonNullable<GrokAdapterShape["compactThread"]> {
  const emitCompaction = (
    ctx: GrokSessionContext,
    event: {
      readonly lifecycle: "item.updated" | "item.completed";
      readonly status: "inProgress" | "completed" | "failed";
      readonly title: string;
      readonly detail?: string;
    },
  ) =>
    Effect.gen(function* () {
      yield* input.offerRuntimeEvent({
        type: event.lifecycle,
        ...(yield* input.makeEventStamp()),
        provider: PROVIDER,
        threadId: ctx.threadId,
        itemId: RuntimeItemId.makeUnsafe(`grok-compaction:${ctx.threadId}`),
        payload: {
          itemType: "context_compaction",
          status: event.status,
          title: event.title,
          ...(event.detail ? { detail: event.detail } : {}),
        },
      });
    });

  const claimSlot = (threadId: ThreadId, preLockCtx: GrokSessionContext) =>
    Effect.gen(function* () {
      const ctx = yield* input.requireSession(threadId);
      if (ctx !== preLockCtx) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "compactThread",
          issue: "The Grok session was restarted while waiting to compact; retry once it settles.",
        });
      }
      if (ctx.resumeReplayReady !== undefined) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "compactThread",
          issue: "Cannot compact while the resumed Grok thread is still replaying history.",
        });
      }
      if (ctx.compactingThread) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "compactThread",
          issue: "A Grok context compaction is already in progress.",
        });
      }
      if (ctx.activeTurnId !== undefined || ctx.turnStarting) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "compactThread",
          issue: "Cannot compact while a Grok turn is still active.",
        });
      }
      ctx.compactingThread = true;
      ctx.compactionFailedToolDetail = undefined;
      return ctx;
    });

  const runCompaction = (ctx: GrokSessionContext) =>
    Effect.gen(function* () {
      yield* waitForAbandonedGrokCompaction(ctx);
      yield* emitCompaction(ctx, {
        lifecycle: "item.updated",
        status: "inProgress",
        title: "Compacting context",
      });
      const compactResult = yield* ctx.acp
        .prompt({ prompt: [{ type: "text", text: GROK_COMPACT_PROMPT }] })
        .pipe(
          Effect.mapError((error) =>
            mapAcpToAdapterError(PROVIDER, ctx.threadId, "session/prompt", error),
          ),
          Effect.timeoutOption(GROK_COMPACT_TIMEOUT_MS),
          Effect.exit,
        );
      if (Exit.isFailure(compactResult)) {
        if (Cause.hasInterruptsOnly(compactResult.cause)) {
          return yield* Effect.failCause(compactResult.cause);
        }
        const squashed = Cause.squash(compactResult.cause);
        const detail = squashed instanceof Error ? squashed.message : String(squashed);
        yield* emitCompaction(ctx, {
          lifecycle: "item.completed",
          status: "failed",
          title: "Context compaction failed",
          detail,
        });
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "session/prompt",
          detail,
        });
      }
      const promptResponse = Option.getOrUndefined(compactResult.value);
      if (promptResponse === undefined) {
        ctx.compactionQuietUntil = Date.now() + GROK_COMPACT_ABANDON_QUIET_MS;
        ctx.compactionCancelFiber = yield* Effect.ignore(ctx.acp.cancel).pipe(
          Effect.forkIn(ctx.scope),
        );
        const detail = `Grok did not finish context compaction within ${Math.round(GROK_COMPACT_TIMEOUT_MS / 1000)}s; the compaction was abandoned.`;
        yield* Effect.logWarning("grok.acp.compact_timeout", {
          threadId: ctx.threadId,
          timeoutMs: GROK_COMPACT_TIMEOUT_MS,
        });
        yield* emitCompaction(ctx, {
          lifecycle: "item.completed",
          status: "failed",
          title: "Context compaction timed out",
          detail,
        });
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "session/prompt",
          detail,
        });
      }
      yield* settleGrokCompactionOutcome(ctx);
      if (promptResponse.stopReason === "cancelled") {
        const detail = "Grok context compaction was cancelled before it completed.";
        yield* emitCompaction(ctx, {
          lifecycle: "item.completed",
          status: "failed",
          title: "Context compaction cancelled",
          detail,
        });
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "session/prompt",
          detail,
        });
      }
      const failedToolDetail = ctx.compactionFailedToolDetail;
      if (failedToolDetail !== undefined) {
        yield* emitCompaction(ctx, {
          lifecycle: "item.completed",
          status: "failed",
          title: "Context compaction failed",
          detail: failedToolDetail,
        });
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "session/prompt",
          detail: failedToolDetail,
        });
      }
      yield* input.offerRuntimeEvent({
        type: "thread.state.changed",
        ...(yield* input.makeEventStamp()),
        provider: PROVIDER,
        threadId: ctx.threadId,
        payload: { state: "compacted", detail: { reason: "provider.compactThread" } },
      });
    });

  return (threadId) =>
    Effect.gen(function* () {
      const preLockCtx = yield* input.requireSession(threadId);
      if (preLockCtx.sessionConfigReady !== undefined) {
        yield* Deferred.await(preLockCtx.sessionConfigReady);
      }
      if (preLockCtx.resumeReplayReady !== undefined) {
        yield* Deferred.await(preLockCtx.resumeReplayReady);
      }
      const ctx = yield* input.withThreadLock(threadId, claimSlot(threadId, preLockCtx));
      return yield* runCompaction(ctx).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            ctx.compactingThread = false;
          }),
        ),
      );
    });
}
