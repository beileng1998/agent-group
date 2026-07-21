import { Effect, Ref } from "effect";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  mergeToolCallState,
  parseSessionUpdateEvent,
  type AcpParsedSessionEvent,
  type AcpSessionModeState,
  type AcpToolCallState,
} from "./AcpRuntimeModel.ts";

export interface AcpAssistantSegmentState {
  readonly nextSegmentIndex: number;
  readonly activeItemId?: string;
}

interface EnsureActiveAssistantSegmentResult {
  readonly itemId: string;
  readonly completedEvent?: Extract<
    AcpParsedSessionEvent,
    { readonly _tag: "AssistantItemCompleted" }
  >;
  readonly startedEvent?: Extract<AcpParsedSessionEvent, { readonly _tag: "AssistantItemStarted" }>;
}

export const handleSessionUpdate = ({
  offer,
  modeStateRef,
  toolCallsRef,
  assistantSegmentRef,
  runtimeInstanceId,
  params,
}: {
  readonly offer: (event: AcpParsedSessionEvent) => Effect.Effect<void>;
  readonly modeStateRef: Ref.Ref<AcpSessionModeState | undefined>;
  readonly toolCallsRef: Ref.Ref<Map<string, AcpToolCallState>>;
  readonly assistantSegmentRef: Ref.Ref<AcpAssistantSegmentState>;
  readonly runtimeInstanceId: string;
  readonly params: EffectAcpSchema.SessionNotification;
}): Effect.Effect<void> =>
  Effect.gen(function* () {
    const parsed = parseSessionUpdateEvent(params);
    if (parsed.modeId) {
      yield* Ref.update(modeStateRef, (current) =>
        current === undefined ? current : updateModeState(current, parsed.modeId!),
      );
    }
    for (const event of parsed.events) {
      if (event._tag === "ToolCallUpdated") {
        yield* closeActiveAssistantSegment({ offer, assistantSegmentRef });
        const { previous, merged } = yield* Ref.modify(toolCallsRef, (current) => {
          const previous = current.get(event.toolCall.toolCallId);
          const nextToolCall = mergeToolCallState(previous, event.toolCall);
          const next = new Map(current);
          if (nextToolCall.status === "completed" || nextToolCall.status === "failed") {
            next.delete(nextToolCall.toolCallId);
          } else {
            next.set(nextToolCall.toolCallId, nextToolCall);
          }
          return [{ previous, merged: nextToolCall }, next] as const;
        });
        if (!shouldEmitToolCallUpdate(previous, merged)) {
          continue;
        }
        yield* offer({
          _tag: "ToolCallUpdated",
          toolCall: merged,
          rawPayload: event.rawPayload,
        });
        continue;
      }
      if (event._tag === "ContentDelta") {
        if (event.streamKind === "reasoning_text") {
          yield* offer(event);
          continue;
        }
        if (event.text.trim().length === 0) {
          const assistantSegmentState = yield* Ref.get(assistantSegmentRef);
          if (!assistantSegmentState.activeItemId) {
            continue;
          }
        }
        const itemId = yield* ensureActiveAssistantSegment({
          offer,
          assistantSegmentRef,
          sessionId: params.sessionId,
          runtimeInstanceId,
          requestedItemId: event.itemId,
        });
        yield* offer({ ...event, itemId });
        continue;
      }
      yield* offer(event);
    }
  });

function updateModeState(modeState: AcpSessionModeState, nextModeId: string): AcpSessionModeState {
  const normalized = nextModeId.trim();
  if (!normalized) {
    return modeState;
  }
  return modeState.availableModes.some((mode) => mode.id === normalized)
    ? { ...modeState, currentModeId: normalized }
    : modeState;
}

function shouldEmitToolCallUpdate(
  previous: AcpToolCallState | undefined,
  next: AcpToolCallState,
): boolean {
  if (previous === undefined) return true;
  if (next.status === "completed" || next.status === "failed") return true;
  if (previous.status !== next.status || previous.title !== next.title) return true;
  if (!next.detail) return false;
  return previous.detail !== next.detail;
}

export const assistantItemId = (
  sessionId: string,
  runtimeInstanceId: string,
  segmentIndex: number,
) => `assistant:${sessionId}:${runtimeInstanceId}:segment:${segmentIndex}`;

const ensureActiveAssistantSegment = ({
  offer,
  assistantSegmentRef,
  sessionId,
  runtimeInstanceId,
  requestedItemId,
}: {
  readonly offer: (event: AcpParsedSessionEvent) => Effect.Effect<void>;
  readonly assistantSegmentRef: Ref.Ref<AcpAssistantSegmentState>;
  readonly sessionId: string;
  readonly runtimeInstanceId: string;
  readonly requestedItemId?: string | undefined;
}) =>
  Ref.modify<AcpAssistantSegmentState, EnsureActiveAssistantSegmentResult>(
    assistantSegmentRef,
    (current) => {
      if (current.activeItemId && current.activeItemId === requestedItemId) {
        return [{ itemId: current.activeItemId }, current] as const;
      }
      if (current.activeItemId && requestedItemId === undefined) {
        return [{ itemId: current.activeItemId }, current] as const;
      }
      const itemId =
        requestedItemId ?? assistantItemId(sessionId, runtimeInstanceId, current.nextSegmentIndex);
      const completedEvent = current.activeItemId
        ? ({
            _tag: "AssistantItemCompleted",
            itemId: current.activeItemId,
          } satisfies Extract<AcpParsedSessionEvent, { readonly _tag: "AssistantItemCompleted" }>)
        : undefined;
      return [
        {
          itemId,
          ...(completedEvent ? { completedEvent } : {}),
          startedEvent: {
            _tag: "AssistantItemStarted",
            itemId,
          } satisfies Extract<AcpParsedSessionEvent, { readonly _tag: "AssistantItemStarted" }>,
        },
        {
          nextSegmentIndex:
            requestedItemId === undefined ? current.nextSegmentIndex + 1 : current.nextSegmentIndex,
          activeItemId: itemId,
        } satisfies AcpAssistantSegmentState,
      ] as const;
    },
  ).pipe(
    Effect.flatMap((result) =>
      Effect.gen(function* () {
        if (result.completedEvent) yield* offer(result.completedEvent);
        if (result.startedEvent) yield* offer(result.startedEvent);
        return result.itemId;
      }),
    ),
  );

export const closeActiveAssistantSegment = ({
  offer,
  assistantSegmentRef,
}: {
  readonly offer: (event: AcpParsedSessionEvent) => Effect.Effect<void>;
  readonly assistantSegmentRef: Ref.Ref<AcpAssistantSegmentState>;
}) =>
  Ref.modify(assistantSegmentRef, (current) => {
    if (!current.activeItemId) {
      return [undefined, current] as const;
    }
    return [
      {
        _tag: "AssistantItemCompleted",
        itemId: current.activeItemId,
      } satisfies AcpParsedSessionEvent,
      { nextSegmentIndex: current.nextSegmentIndex } satisfies AcpAssistantSegmentState,
    ] as const;
  }).pipe(Effect.flatMap((event) => (event ? offer(event) : Effect.void)));
