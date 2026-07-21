import {
  type EventId,
  type ProviderRuntimeEvent,
  type ThreadId,
  TurnId,
} from "@agent-group/contracts";
import { Deferred, Effect, Fiber, FileSystem } from "effect";
import type * as EffectAcpSchema from "effect-acp/schema";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import { appendFileAttachmentsPromptBlock } from "./attachmentProjection.ts";
import { filterProviderPromptImageAttachments } from "./promptAttachments.ts";
import { classifyAcpPromptTurnCompletion, mapAcpToAdapterError } from "./acp/AcpAdapterSupport.ts";
import { forkAcpTurnIdleWatchdog, resolveAcpTurnIdleTimeoutMs } from "./acp/AcpTurnIdleWatchdog.ts";
import { resolveCursorAcpBaseModelId } from "./acp/CursorAcpSupport.ts";
import {
  clearCursorActiveTurn,
  finalizeCursorActiveTurnCost,
  applyRequestedCursorSessionConfiguration,
  settlePendingApprovalsAsCancelled,
  settlePendingUserInputsAsEmptyAnswers,
  withCursorPlanModePrompt,
  type CursorSessionContext,
} from "./cursorAdapterSessionState.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "./Errors.ts";
import type { CursorAdapterShape } from "./Services/CursorAdapter.ts";

const PROVIDER = "cursor" as const;
const CURSOR_TURN_IDLE_TIMEOUT_MS = resolveAcpTurnIdleTimeoutMs({
  envVar: "AGENT_GROUP_CURSOR_TURN_IDLE_TIMEOUT_MS",
  defaultMs: 600_000,
});
const CURSOR_TURN_WATCHDOG_INTERVAL_MS = 15_000;
type EventStamp = { readonly eventId: EventId; readonly createdAt: string };

export function makeCursorTurnOperations(input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly attachmentsDir: string;
  readonly nowIso: Effect.Effect<string>;
  readonly makeEventStamp: () => Effect.Effect<EventStamp>;
  readonly offerRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly requireSession: (
    threadId: ThreadId,
  ) => Effect.Effect<CursorSessionContext, ProviderAdapterSessionNotFoundError>;
  readonly failTurnAsTimedOut: (
    ctx: CursorSessionContext,
    turnId: TurnId,
    idleMs: number,
  ) => Effect.Effect<void>;
}): Pick<
  CursorAdapterShape,
  | "sendTurn"
  | "interruptTurn"
  | "respondToRequest"
  | "respondToUserInput"
  | "readThread"
  | "rollbackThread"
> {
  const sendTurn: CursorAdapterShape["sendTurn"] = (request) =>
    Effect.gen(function* () {
      const ctx = yield* input.requireSession(request.threadId);
      const turnId = TurnId.makeUnsafe(crypto.randomUUID());
      const turnModelSelection =
        request.modelSelection?.provider === PROVIDER ? request.modelSelection : undefined;
      const model = turnModelSelection?.model ?? ctx.session.model;
      const resolvedModel = resolveCursorAcpBaseModelId(model);
      yield* applyRequestedCursorSessionConfiguration({
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
          ? withCursorPlanModePrompt({
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

      ctx.activeTurnId = turnId;
      ctx.activeTurnFailedToolDetail = undefined;
      ctx.activeInteractionMode = request.interactionMode;
      ctx.lastPlanFingerprint = undefined;
      ctx.completedPlanFingerprint = undefined;
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
        payload: { model: resolvedModel },
      });

      const runPrompt = ctx.acp.prompt({ prompt: promptParts }).pipe(
        Effect.mapError((error) =>
          mapAcpToAdapterError(PROVIDER, request.threadId, "session/prompt", error),
        ),
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.gen(function* () {
              if (!clearCursorActiveTurn(ctx, turnId)) return;
              const completedCost = finalizeCursorActiveTurnCost(ctx);
              ctx.turns.push({ id: turnId, items: [{ prompt: promptParts, error }] });
              const detail = error.message;
              ctx.session = {
                ...ctx.session,
                status: "error",
                updatedAt: yield* input.nowIso,
                model: resolvedModel,
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
              const failedToolDetail = ctx.activeTurnFailedToolDetail;
              if (!clearCursorActiveTurn(ctx, turnId)) return;
              const completedCost = finalizeCursorActiveTurnCost(ctx);
              ctx.turns.push({ id: turnId, items: [{ prompt: promptParts, result }] });
              const { lastError: _lastError, ...sessionWithoutLastError } = ctx.session;
              ctx.session = {
                ...sessionWithoutLastError,
                status: "ready",
                updatedAt: yield* input.nowIso,
                model: resolvedModel,
              };
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
            if (!clearCursorActiveTurn(ctx, turnId)) return;
            const completedCost = finalizeCursorActiveTurnCost(ctx);
            ctx.turns.push({ id: turnId, items: [{ prompt: promptParts, interrupted: true }] });
            const { lastError: _lastError, ...sessionWithoutLastError } = ctx.session;
            ctx.session = {
              ...sessionWithoutLastError,
              status: "ready",
              updatedAt: yield* input.nowIso,
              model: resolvedModel,
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
        idleTimeoutMs: CURSOR_TURN_IDLE_TIMEOUT_MS,
        checkIntervalMs: CURSOR_TURN_WATCHDOG_INTERVAL_MS,
        scope: ctx.scope,
        isTurnActive: () => ctx.activeTurnId === turnId && !ctx.stopped,
        isAwaitingHuman: () => ctx.pendingApprovals.size > 0 || ctx.pendingUserInputs.size > 0,
        lastActivityAt: () => ctx.lastTurnActivityAt ?? Date.now(),
        touchActivity: () => {
          ctx.lastTurnActivityAt = Date.now();
        },
        onIdleTimeout: (idleMs) => input.failTurnAsTimedOut(ctx, turnId, idleMs),
      });
      return {
        threadId: request.threadId,
        turnId,
        ...(ctx.session.resumeCursor !== undefined
          ? { resumeCursor: ctx.session.resumeCursor }
          : {}),
      };
    });

  const interruptTurn: CursorAdapterShape["interruptTurn"] = (threadId) =>
    Effect.gen(function* () {
      const ctx = yield* input.requireSession(threadId);
      yield* settlePendingApprovalsAsCancelled(ctx.pendingApprovals);
      yield* settlePendingUserInputsAsEmptyAnswers(ctx.pendingUserInputs);
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

  const respondToRequest: CursorAdapterShape["respondToRequest"] = (
    threadId,
    requestId,
    decision,
  ) =>
    Effect.gen(function* () {
      const ctx = yield* input.requireSession(threadId);
      const pending = ctx.pendingApprovals.get(requestId);
      if (!pending) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "session/request_permission",
          detail: `Unknown pending approval request: ${requestId}`,
        });
      }
      yield* Deferred.succeed(pending.decision, decision);
    });

  const respondToUserInput: CursorAdapterShape["respondToUserInput"] = (
    threadId,
    requestId,
    answers,
  ) =>
    Effect.gen(function* () {
      const ctx = yield* input.requireSession(threadId);
      const pending = ctx.pendingUserInputs.get(requestId);
      if (!pending) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "cursor/ask_question",
          detail: `Unknown pending user-input request: ${requestId}`,
        });
      }
      yield* Deferred.succeed(pending.answers, answers);
    });

  const readThread: CursorAdapterShape["readThread"] = (threadId) =>
    Effect.gen(function* () {
      const ctx = yield* input.requireSession(threadId);
      return { threadId, turns: ctx.turns };
    });

  const rollbackThread: CursorAdapterShape["rollbackThread"] = (threadId, numTurns) =>
    Effect.gen(function* () {
      const ctx = yield* input.requireSession(threadId);
      if (!Number.isInteger(numTurns) || numTurns < 1) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "rollbackThread",
          issue: "numTurns must be an integer >= 1.",
        });
      }
      ctx.turns.splice(Math.max(0, ctx.turns.length - numTurns));
      return { threadId, turns: ctx.turns };
    });

  return {
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    readThread,
    rollbackThread,
  };
}
