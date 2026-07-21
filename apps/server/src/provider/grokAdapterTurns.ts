import { type EventId, type ProviderRuntimeEvent, type ThreadId, TurnId } from "@agent-group/contracts";
import { Deferred, Effect, Fiber, FileSystem } from "effect";
import type * as EffectAcpSchema from "effect-acp/schema";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import { appendFileAttachmentsPromptBlock } from "./attachmentProjection.ts";
import { filterProviderPromptImageAttachments } from "./promptAttachments.ts";
import { classifyAcpPromptTurnCompletion, mapAcpToAdapterError } from "./acp/AcpAdapterSupport.ts";
import {
  settleAcpPendingApprovalsAsCancelled,
  settleAcpPendingUserInputsAsEmptyAnswers,
} from "./acp/AcpAdapterSessionSupport.ts";
import { forkAcpTurnIdleWatchdog, resolveAcpTurnIdleTimeoutMs } from "./acp/AcpTurnIdleWatchdog.ts";
import {
  waitForAbandonedGrokCompaction,
  waitForGrokQueuedTurnEventsDrained,
} from "./grokAdapterCoordination.ts";
import {
  applyRequestedGrokSessionConfiguration,
  clearGrokActiveTurn,
  finalizeGrokActiveTurnCost,
  type GrokSessionContext,
  withGrokPlanModePrompt,
} from "./grokAdapterSessionState.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "./Errors.ts";
import type { GrokAdapterShape } from "./Services/GrokAdapter.ts";

const PROVIDER = "grok" as const;
const GROK_TURN_IDLE_TIMEOUT_MS = resolveAcpTurnIdleTimeoutMs({
  envVar: "AGENT_GROUP_GROK_TURN_IDLE_TIMEOUT_MS",
  defaultMs: 600_000,
});
const GROK_TURN_WATCHDOG_INTERVAL_MS = 15_000;
type EventStamp = { readonly eventId: EventId; readonly createdAt: string };

export function makeGrokTurnOperations(input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly attachmentsDir: string;
  readonly nowIso: Effect.Effect<string>;
  readonly makeEventStamp: () => Effect.Effect<EventStamp>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly requireSession: (
    threadId: ThreadId,
  ) => Effect.Effect<GrokSessionContext, ProviderAdapterSessionNotFoundError>;
}): Pick<GrokAdapterShape, "sendTurn" | "interruptTurn"> {
  const failTurnAsTimedOut = (ctx: GrokSessionContext, turnId: TurnId, idleMs: number) =>
    Effect.gen(function* () {
      const promptFiber = ctx.activePromptFiber;
      if (!clearGrokActiveTurn(ctx, turnId)) return;
      const completedCost = finalizeGrokActiveTurnCost(ctx);
      const idleSeconds = Math.round(idleMs / 1000);
      const detail = `Grok stopped responding (no activity for ${idleSeconds}s); the turn was timed out.`;
      ctx.turns.push({ id: turnId, items: [{ prompt: turnId, timedOut: true, idleMs }] });
      ctx.session = {
        ...ctx.session,
        status: "error",
        updatedAt: yield* input.nowIso,
        lastError: detail,
      };
      yield* Effect.logWarning("grok.acp.turn_idle_timeout", {
        threadId: ctx.threadId,
        turnId,
        idleMs,
      });
      yield* input.offerRuntimeEvent({
        type: "turn.completed",
        ...(yield* input.makeEventStamp()),
        provider: PROVIDER,
        threadId: ctx.threadId,
        turnId,
        payload: {
          state: "failed",
          stopReason: null,
          errorMessage: detail,
          ...completedCost,
        },
      });
      yield* Effect.ignore(ctx.acp.cancel).pipe(Effect.forkIn(ctx.scope));
      if (promptFiber) yield* Fiber.interrupt(promptFiber);
    });

  const startTurn = (
    ctx: GrokSessionContext,
    request: Parameters<GrokAdapterShape["sendTurn"]>[0],
  ) =>
    Effect.gen(function* () {
      if (ctx.sessionConfigReady !== undefined) yield* Deferred.await(ctx.sessionConfigReady);
      if (ctx.resumeReplayReady !== undefined) yield* Deferred.await(ctx.resumeReplayReady);
      yield* waitForAbandonedGrokCompaction(ctx);
      if (ctx.stopped) {
        return yield* new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId: request.threadId,
        });
      }
      const turnId = TurnId.makeUnsafe(crypto.randomUUID());
      const turnModelSelection =
        request.modelSelection?.provider === PROVIDER ? request.modelSelection : undefined;
      const model = turnModelSelection?.model ?? ctx.session.model;
      yield* applyRequestedGrokSessionConfiguration({
        runtime: ctx.acp,
        runtimeMode: ctx.session.runtimeMode,
        interactionMode: request.interactionMode,
        modelSelection:
          model === undefined ? undefined : { model, options: turnModelSelection?.options },
        mapError: ({ cause, method }) =>
          mapAcpToAdapterError(PROVIDER, request.threadId, method, cause),
      });

      const promptParts: Array<EffectAcpSchema.ContentBlock> = [];
      const promptText = appendFileAttachmentsPromptBlock({
        text: request.input?.trim()
          ? withGrokPlanModePrompt({
              text: request.input.trim(),
              ...(request.interactionMode !== undefined
                ? { interactionMode: request.interactionMode }
                : {}),
            })
          : undefined,
        attachments: request.attachments,
        attachmentsDir: input.attachmentsDir,
        include: "all-files",
      });
      if (promptText) promptParts.push({ type: "text", text: promptText });
      if (request.attachments && request.attachments.length > 0) {
        for (const attachment of filterProviderPromptImageAttachments(request.attachments)) {
          const attachmentPath = resolveAttachmentPath({
            attachmentsDir: input.attachmentsDir,
            attachment,
          });
          if (!attachmentPath) {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/prompt",
              detail: `Invalid attachment id '${attachment.id}'.`,
            });
          }
          const bytes = yield* input.fileSystem.readFile(attachmentPath).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/prompt",
                  detail: cause.message,
                  cause,
                }),
            ),
          );
          promptParts.push({
            type: "image",
            data: Buffer.from(bytes).toString("base64"),
            mimeType: attachment.mimeType,
          });
        }
      }
      if (promptParts.length === 0) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Turn requires non-empty text or attachments.",
        });
      }
      if (ctx.stopped) {
        return yield* new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId: request.threadId,
        });
      }

      ctx.activeTurnId = turnId;
      ctx.activeTurnHadAssistantContent = false;
      ctx.activeAssistantItemsWithContent.clear();
      ctx.activeTurnFailedToolDetail = undefined;
      ctx.turnToolCallIds.clear();
      ctx.activeInteractionMode = request.interactionMode;
      ctx.lastPlanFingerprint = undefined;
      ctx.lastTurnActivityAt = Date.now();
      const { lastError: _lastError, ...sessionWithoutLastError } = ctx.session;
      ctx.session = {
        ...sessionWithoutLastError,
        status: "running",
        activeTurnId: turnId,
        updatedAt: yield* input.nowIso,
      };
      yield* input.offerRuntimeEvent({
        type: "turn.started",
        ...(yield* input.makeEventStamp()),
        provider: PROVIDER,
        threadId: request.threadId,
        turnId,
        payload: { ...(model ? { model } : {}) },
      });

      const runPrompt = Effect.suspend(() =>
        ctx.pendingTurnInterrupted || ctx.stopped
          ? Effect.interrupt
          : ctx.acp.prompt({ prompt: promptParts }),
      ).pipe(
        Effect.mapError((error) =>
          mapAcpToAdapterError(PROVIDER, request.threadId, "session/prompt", error),
        ),
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.gen(function* () {
              yield* waitForGrokQueuedTurnEventsDrained(ctx);
              if (!clearGrokActiveTurn(ctx, turnId)) return;
              const completedCost = finalizeGrokActiveTurnCost(ctx);
              ctx.turns.push({ id: turnId, items: [{ prompt: promptParts, error }] });
              const detail = error.message;
              ctx.session = {
                ...ctx.session,
                status: "error",
                updatedAt: yield* input.nowIso,
                ...(model ? { model } : {}),
                lastError: detail,
              };
              yield* input.offerRuntimeEvent({
                type: "turn.completed",
                ...(yield* input.makeEventStamp()),
                provider: PROVIDER,
                threadId: request.threadId,
                turnId,
                payload: {
                  state: "failed",
                  stopReason: null,
                  errorMessage: detail,
                  ...completedCost,
                },
              });
            }),
          onSuccess: (result) =>
            Effect.gen(function* () {
              yield* waitForGrokQueuedTurnEventsDrained(ctx);
              const hadAssistantContent = ctx.activeTurnHadAssistantContent;
              const failedToolDetail = ctx.activeTurnFailedToolDetail;
              if (!clearGrokActiveTurn(ctx, turnId)) return;
              const completedCost = finalizeGrokActiveTurnCost(ctx);
              ctx.turns.push({ id: turnId, items: [{ prompt: promptParts, result }] });
              const { lastError: _lastError, ...sessionWithoutLastError } = ctx.session;
              ctx.session = {
                ...sessionWithoutLastError,
                status: "ready",
                updatedAt: yield* input.nowIso,
                ...(model ? { model } : {}),
              };
              if (!hadAssistantContent && result.stopReason !== "cancelled") {
                yield* Effect.logWarning("grok.acp.turn_completed_without_content", {
                  threadId: request.threadId,
                  turnId,
                  stopReason: result.stopReason ?? null,
                  hasUsage: result.usage !== undefined,
                });
              }
              const completion = classifyAcpPromptTurnCompletion({
                stopReason: result.stopReason,
                ...(failedToolDetail !== undefined ? { failedToolDetail } : {}),
              });
              yield* input.offerRuntimeEvent({
                type: "turn.completed",
                ...(yield* input.makeEventStamp()),
                provider: PROVIDER,
                threadId: request.threadId,
                turnId,
                payload: {
                  state: completion.state,
                  stopReason: result.stopReason ?? null,
                  ...(completion.errorMessage !== undefined
                    ? { errorMessage: completion.errorMessage }
                    : {}),
                  ...(result.usage ? { usage: result.usage } : {}),
                  ...completedCost,
                },
              });
            }),
        }),
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            if (!clearGrokActiveTurn(ctx, turnId)) return;
            const completedCost = finalizeGrokActiveTurnCost(ctx);
            ctx.turns.push({ id: turnId, items: [{ prompt: promptParts, interrupted: true }] });
            const { lastError: _lastError, ...sessionWithoutLastError } = ctx.session;
            ctx.session = {
              ...sessionWithoutLastError,
              status: "ready",
              updatedAt: yield* input.nowIso,
              ...(model ? { model } : {}),
            };
            yield* input.offerRuntimeEvent({
              type: "turn.completed",
              ...(yield* input.makeEventStamp()),
              provider: PROVIDER,
              threadId: request.threadId,
              turnId,
              payload: { state: "cancelled", stopReason: "cancelled", ...completedCost },
            });
          }),
        ),
        Effect.ignoreCause({ log: true }),
        Effect.forkIn(ctx.scope),
      );
      ctx.activePromptFiber = yield* runPrompt;
      yield* forkAcpTurnIdleWatchdog({
        idleTimeoutMs: GROK_TURN_IDLE_TIMEOUT_MS,
        checkIntervalMs: GROK_TURN_WATCHDOG_INTERVAL_MS,
        scope: ctx.scope,
        isTurnActive: () => ctx.activeTurnId === turnId && !ctx.stopped,
        isAwaitingHuman: () => ctx.pendingApprovals.size > 0 || ctx.pendingUserInputs.size > 0,
        lastActivityAt: () => ctx.lastTurnActivityAt ?? Date.now(),
        touchActivity: () => {
          ctx.lastTurnActivityAt = Date.now();
        },
        onIdleTimeout: (idleMs) => failTurnAsTimedOut(ctx, turnId, idleMs),
      });
      return {
        threadId: request.threadId,
        turnId,
        ...(ctx.session.resumeCursor !== undefined
          ? { resumeCursor: ctx.session.resumeCursor }
          : {}),
      };
    });

  const sendTurn: GrokAdapterShape["sendTurn"] = (request) =>
    Effect.gen(function* () {
      const ctx = yield* input.requireSession(request.threadId);
      if (ctx.compactingThread) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Cannot start a turn while Grok context compaction is in progress.",
        });
      }
      if (ctx.turnStarting) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Another Grok turn is still starting for this thread.",
        });
      }
      ctx.turnStarting = true;
      ctx.pendingTurnInterrupted = false;
      return yield* startTurn(ctx, request).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            ctx.turnStarting = false;
          }),
        ),
      );
    });

  const interruptTurn: GrokAdapterShape["interruptTurn"] = (threadId) =>
    Effect.gen(function* () {
      const ctx = yield* input.requireSession(threadId);
      if (ctx.turnStarting && ctx.activePromptFiber === undefined) {
        ctx.pendingTurnInterrupted = true;
      }
      yield* settleAcpPendingApprovalsAsCancelled(ctx.pendingApprovals);
      yield* settleAcpPendingUserInputsAsEmptyAnswers(ctx.pendingUserInputs);
      const activePromptFiber = ctx.activePromptFiber;
      yield* Effect.ignore(
        ctx.acp.cancel.pipe(
          Effect.mapError((error) =>
            mapAcpToAdapterError(PROVIDER, threadId, "session/cancel", error),
          ),
        ),
      );
      if (activePromptFiber) yield* Fiber.interrupt(activePromptFiber);
    });

  return { sendTurn, interruptTurn };
}
