import {
  MessageId,
  type OrchestrationThread,
  type ProviderRuntimeEvent,
  type TurnId,
} from "@agent-group/contracts";
import { Effect, Ref } from "effect";

import {
  generatedImageMarkdown,
  generatedImagePathFromRuntimeEvent,
} from "../codexGeneratedImages.ts";
import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine.ts";
import type { makeProviderRuntimeAssistantMessages } from "./providerRuntimeAssistantMessages.ts";
import type { ProviderRuntimeBufferState } from "./providerRuntimeBufferState.ts";
import {
  reasoningSummaryBufferKey,
  toolOutputBufferKey,
  toolOutputStreamKind,
} from "./providerRuntimeBufferValues.ts";
import type { makeProviderRuntimeBuffers } from "./providerRuntimeBuffers.ts";
import type { makeProviderRuntimeDiff } from "./providerRuntimeDiff.ts";
import type { makeProviderRuntimeGeneratedImages } from "./providerRuntimeGeneratedImages.ts";
import type { makeProviderRuntimePlans } from "./providerRuntimePlans.ts";
import type { makeProviderRuntimeSessionCleanup } from "./providerRuntimeSessionCleanup.ts";
import type { makeProviderRuntimeVisualizations } from "./providerRuntimeVisualizations.ts";
import {
  inferRuntimeModeFromUserInputAnswers,
  providerCommandId,
  proposedPlanIdForTurn,
  proposedPlanIdFromEvent,
  runtimeErrorMessageFromEvent,
  sameId,
  STRICT_PROVIDER_LIFECYCLE_GUARD,
  toTurnId,
} from "./providerRuntimeIngestionValues.ts";

type Assistants = ReturnType<typeof makeProviderRuntimeAssistantMessages>;
type Buffers = ReturnType<typeof makeProviderRuntimeBuffers>;
type Images = ReturnType<typeof makeProviderRuntimeGeneratedImages>;
type Plans = ReturnType<typeof makeProviderRuntimePlans>;
type Diff = ReturnType<typeof makeProviderRuntimeDiff>;
type Cleanup = ReturnType<typeof makeProviderRuntimeSessionCleanup>;
type Visualizations = ReturnType<typeof makeProviderRuntimeVisualizations>;

export function makeProviderRuntimeEventProjection(input: {
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly state: ProviderRuntimeBufferState;
  readonly assistants: Assistants;
  readonly buffers: Buffers;
  readonly images: Images;
  readonly plans: Plans;
  readonly diff: Diff;
  readonly cleanup: Cleanup;
  readonly visualizations: Visualizations;
}) {
  const projectEvent = (params: {
    readonly event: ProviderRuntimeEvent;
    readonly thread: OrchestrationThread;
    readonly activeTurnId: TurnId | null;
    readonly eventTurnId: TurnId | undefined;
    readonly isTerminalTurnEvent: boolean;
  }) =>
    Effect.gen(function* () {
      const { event, thread, activeTurnId, eventTurnId, isTerminalTurnEvent } = params;
      const now = event.createdAt;
      if (event.type === "user-input.resolved") {
        const runtimeMode = inferRuntimeModeFromUserInputAnswers(event.payload.answers);
        if (runtimeMode && runtimeMode !== thread.runtimeMode) {
          yield* input.orchestrationEngine.dispatch({
            type: "thread.runtime-mode.set",
            commandId: providerCommandId(event, "thread-runtime-mode-set"),
            threadId: thread.id,
            runtimeMode,
            createdAt: now,
          });
        }
      }

      const toolOutputKind = toolOutputStreamKind(event);
      const toolOutputKey = toolOutputBufferKey(event);
      if (
        toolOutputKind &&
        toolOutputKey &&
        event.type === "content.delta" &&
        event.payload.delta.length > 0
      ) {
        yield* input.buffers.appendBufferedToolOutput(toolOutputKey, event.payload.delta);
      }
      const reasoningSummaryKey = reasoningSummaryBufferKey(event, thread.id);
      if (
        reasoningSummaryKey &&
        event.type === "content.delta" &&
        (event.payload.streamKind === "reasoning_summary_text" ||
          (event.provider === "antigravity" && event.payload.streamKind === "reasoning_text")) &&
        event.payload.delta.length > 0
      ) {
        yield* input.buffers.appendBufferedReasoningSummary(reasoningSummaryKey, event);
      }

      const assistantDelta =
        event.type === "content.delta" && event.payload.streamKind === "assistant_text"
          ? event.payload.delta
          : undefined;
      if (assistantDelta && assistantDelta.length > 0) {
        const messageId = MessageId.makeUnsafe(
          `assistant:${event.itemId ?? event.turnId ?? event.eventId}`,
        );
        const turnId = toTurnId(event.turnId);
        if (turnId)
          yield* input.assistants.rememberAssistantMessageId(thread.id, turnId, messageId);
        if ((yield* Ref.get(input.state.assistantDeliveryModeRef)) === "buffered") {
          const spillChunk = yield* input.assistants.appendBufferedAssistantText(
            messageId,
            assistantDelta,
          );
          if (spillChunk.length > 0) {
            yield* input.orchestrationEngine.dispatch({
              type: "thread.message.assistant.delta",
              commandId: providerCommandId(event, "assistant-delta-buffer-spill"),
              threadId: thread.id,
              messageId,
              delta: spillChunk,
              ...(turnId ? { turnId } : {}),
              createdAt: now,
            });
          }
        } else {
          yield* input.orchestrationEngine.dispatch({
            type: "thread.message.assistant.delta",
            commandId: providerCommandId(event, "assistant-delta"),
            threadId: thread.id,
            messageId,
            delta: assistantDelta,
            ...(turnId ? { turnId } : {}),
            createdAt: now,
          });
        }
      }

      if (event.type === "turn.proposed.delta" && event.payload.delta.length > 0) {
        yield* input.buffers.appendBufferedProposedPlan(
          proposedPlanIdFromEvent(event, thread.id),
          event.payload.delta,
          now,
        );
      }

      if (event.type === "item.completed" && event.payload.itemType === "assistant_message") {
        const turnId = toTurnId(event.turnId);
        const messageId = yield* input.assistants.resolveAssistantCompletionMessageId({
          event,
          thread,
          ...(turnId ? { turnId } : {}),
        });
        const existing = thread.messages.find((entry) => entry.id === messageId);
        yield* input.visualizations.captureAssistantMessage({ event, thread, messageId });
        if (turnId)
          yield* input.assistants.rememberAssistantMessageId(thread.id, turnId, messageId);
        yield* input.assistants.finalizeAssistantMessage({
          event,
          threadId: thread.id,
          messageId,
          ...(turnId ? { turnId } : {}),
          createdAt: now,
          commandTag: "assistant-complete",
          finalDeltaCommandTag: "assistant-delta-finalize",
          ...(event.payload.detail !== undefined && (!existing || existing.text.length === 0)
            ? { fallbackText: event.payload.detail }
            : {}),
        });
        if (turnId) yield* input.assistants.forgetAssistantMessageId(thread.id, turnId, messageId);
      }

      if (event.type === "turn.proposed.completed") {
        const turnId = toTurnId(event.turnId);
        yield* input.plans.finalizeBufferedProposedPlan({
          event,
          threadId: thread.id,
          threadProposedPlans: thread.proposedPlans,
          planId: proposedPlanIdFromEvent(event, thread.id),
          ...(turnId ? { turnId } : {}),
          fallbackMarkdown: event.payload.planMarkdown,
          updatedAt: now,
        });
      }

      const generatedImagePath = generatedImagePathFromRuntimeEvent(event);
      if (generatedImagePath) {
        const turnId = toTurnId(event.turnId) ?? activeTurnId ?? undefined;
        const copied = yield* input.images.materializeStudioGeneratedImage({
          event,
          thread,
          imagePath: generatedImagePath,
          turnId,
          createdAt: now,
        });
        const displayPath = copied?.fullPath ?? generatedImagePath;
        if (turnId) {
          yield* input.images.rememberPendingGeneratedImage(thread.id, turnId, displayPath);
        } else {
          const sameItemMessageId = event.itemId
            ? MessageId.makeUnsafe(`assistant:${event.itemId}`)
            : undefined;
          const markdown = generatedImageMarkdown(displayPath);
          const targetMessage = thread.messages.find(
            (message) =>
              message.role === "assistant" &&
              (message.id === sameItemMessageId ||
                message.text.includes(displayPath) ||
                message.text.includes(markdown)),
          );
          yield* input.images.appendGeneratedImagesToAssistantMessage({
            event,
            threadId: thread.id,
            targetMessage,
            newMessageId: MessageId.makeUnsafe(`assistant:image:${event.itemId ?? event.eventId}`),
            imagePaths: [displayPath],
            createdAt: now,
          });
        }
      }

      if (isTerminalTurnEvent) {
        const turnId = eventTurnId ?? activeTurnId ?? undefined;
        if (turnId) {
          const ids = yield* input.assistants.getAssistantMessageIdsForTurn(thread.id, turnId);
          yield* Effect.forEach(
            ids,
            (messageId) =>
              input.assistants.finalizeAssistantMessage({
                event,
                threadId: thread.id,
                messageId,
                turnId,
                createdAt: now,
                commandTag: "assistant-complete-finalize",
                finalDeltaCommandTag: "assistant-delta-finalize-fallback",
              }),
            { concurrency: 1 },
          ).pipe(Effect.asVoid);
          yield* input.assistants.clearAssistantMessageIdsForTurn(thread.id, turnId);
          yield* input.images.flushPendingGeneratedImagesForTurn({
            event,
            thread,
            turnId,
            createdAt: now,
          });
          yield* input.plans.finalizeBufferedProposedPlan({
            event,
            threadId: thread.id,
            threadProposedPlans: thread.proposedPlans,
            planId: proposedPlanIdForTurn(thread.id, turnId),
            turnId,
            updatedAt: now,
          });
          yield* input.diff.clearProviderDiffPlaceholder(thread.id, turnId);
        }
      }

      if (event.type === "session.exited") {
        const turnId = eventTurnId ?? activeTurnId ?? undefined;
        if (turnId) {
          yield* input.assistants.finalizeBufferedAssistantMessagesForTurn({
            event,
            threadId: thread.id,
            turnId,
            createdAt: now,
            commandTag: "assistant-complete-session-exit",
            finalDeltaCommandTag: "assistant-delta-session-exit",
          });
          yield* input.images.flushPendingGeneratedImagesForTurn({
            event,
            thread,
            turnId,
            createdAt: now,
          });
          yield* input.diff.clearProviderDiffPlaceholder(thread.id, turnId);
        }
        yield* input.cleanup.clearTurnStateForSession(thread.id);
      }

      if (event.type === "runtime.error") {
        const errorMessage = runtimeErrorMessageFromEvent(event) ?? "Provider runtime error";
        const turnId = eventTurnId ?? activeTurnId ?? undefined;
        if (turnId) {
          yield* input.assistants.finalizeBufferedAssistantMessagesForTurn({
            event,
            threadId: thread.id,
            turnId,
            createdAt: now,
            commandTag: "assistant-complete-runtime-error",
            finalDeltaCommandTag: "assistant-delta-runtime-error",
          });
          yield* input.images.flushPendingGeneratedImagesForTurn({
            event,
            thread,
            turnId,
            createdAt: now,
          });
          yield* input.diff.clearProviderDiffPlaceholder(thread.id, turnId);
        }
        const applies =
          !STRICT_PROVIDER_LIFECYCLE_GUARD ||
          activeTurnId === null ||
          eventTurnId === undefined ||
          sameId(activeTurnId, eventTurnId);
        if (applies) {
          yield* input.orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: providerCommandId(event, "runtime-error-session-set"),
            threadId: thread.id,
            session: {
              threadId: thread.id,
              status: "error",
              providerName: event.provider,
              runtimeMode: thread.session?.runtimeMode ?? "full-access",
              activeTurnId: eventTurnId ?? null,
              lastError: errorMessage,
              updatedAt: now,
            },
            createdAt: now,
          });
        }
      }

      if (event.type === "thread.metadata.updated" && event.payload.name) {
        yield* input.orchestrationEngine.dispatch({
          type: "thread.meta.update",
          commandId: providerCommandId(event, "thread-meta-update"),
          threadId: thread.id,
          title: event.payload.name,
        });
      }

      return { toolOutputKey, reasoningSummaryKey };
    });

  return { projectEvent };
}
