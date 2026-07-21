import {
  EventId,
  type ProviderRuntimeEvent,
  type ThreadId,
  type TurnId,
} from "@agent-group/contracts";
import { Cache, Effect, Option } from "effect";

import { runtimeEventToActivities } from "./providerRuntimeActivityProjection.ts";
import type { ProviderRuntimeBufferState } from "./providerRuntimeBufferState.ts";
import {
  appendCappedBufferedText,
  bufferedReasoningTerminalStatus,
  joinedBufferedReasoningSummary,
} from "./providerRuntimeBufferValues.ts";

const MAX_BUFFERED_PROPOSED_PLAN_CHARS = 64_000;
const MAX_BUFFERED_TOOL_OUTPUT_CHARS = 24_000;
const MAX_BUFFERED_REASONING_SUMMARY_CHARS = 8_000;
const MAX_BUFFERED_REASONING_SUMMARY_PARTS = 24;

export function makeProviderRuntimeBuffers<DispatchError>(input: {
  readonly state: ProviderRuntimeBufferState;
  readonly dispatchActivityUpdate: (
    event: ProviderRuntimeEvent,
    threadId: ThreadId,
    activity: ReturnType<typeof runtimeEventToActivities>[number],
  ) => Effect.Effect<void, DispatchError>;
}) {
  const appendBufferedProposedPlan = (planId: string, delta: string, createdAt: string) =>
    Cache.getOption(input.state.bufferedProposedPlanById, planId).pipe(
      Effect.flatMap((existingEntry) => {
        const existing = Option.getOrUndefined(existingEntry);
        return Cache.set(input.state.bufferedProposedPlanById, planId, {
          text: appendCappedBufferedText(
            existing?.text ?? "",
            delta,
            MAX_BUFFERED_PROPOSED_PLAN_CHARS,
          ),
          createdAt:
            existing?.createdAt && existing.createdAt.length > 0 ? existing.createdAt : createdAt,
        });
      }),
    );

  const takeBufferedProposedPlan = (planId: string) =>
    Cache.getOption(input.state.bufferedProposedPlanById, planId).pipe(
      Effect.flatMap((entry) =>
        Cache.invalidate(input.state.bufferedProposedPlanById, planId).pipe(
          Effect.as(Option.getOrUndefined(entry)),
        ),
      ),
    );

  const clearBufferedProposedPlan = (planId: string) =>
    Cache.invalidate(input.state.bufferedProposedPlanById, planId);

  const appendBufferedToolOutput = (key: string, delta: string) =>
    Cache.getOption(input.state.bufferedToolOutputByKey, key).pipe(
      Effect.flatMap((existingEntry) => {
        const existing = Option.getOrUndefined(existingEntry);
        const existingText = existing?.text ?? "";
        return Cache.set(input.state.bufferedToolOutputByKey, key, {
          text: appendCappedBufferedText(existingText, delta, MAX_BUFFERED_TOOL_OUTPUT_CHARS),
          truncated:
            existing?.truncated === true ||
            existingText.length + delta.length > MAX_BUFFERED_TOOL_OUTPUT_CHARS,
        });
      }),
    );

  const getBufferedToolOutput = (key: string) =>
    Cache.getOption(input.state.bufferedToolOutputByKey, key).pipe(
      Effect.map(Option.getOrUndefined),
    );

  const takeBufferedToolOutput = (key: string) =>
    Cache.getOption(input.state.bufferedToolOutputByKey, key).pipe(
      Effect.flatMap((entry) =>
        Cache.invalidate(input.state.bufferedToolOutputByKey, key).pipe(
          Effect.as(Option.getOrUndefined(entry)),
        ),
      ),
    );

  const appendBufferedReasoningSummary = (
    key: string,
    event: Extract<ProviderRuntimeEvent, { readonly type: "content.delta" }>,
  ) =>
    Cache.getOption(input.state.bufferedReasoningSummaryByKey, key).pipe(
      Effect.flatMap((existingEntry) => {
        const summaryIndex = event.payload.summaryIndex ?? 0;
        const delta = event.payload.delta;
        if (
          summaryIndex < 0 ||
          summaryIndex >= MAX_BUFFERED_REASONING_SUMMARY_PARTS ||
          delta.length === 0
        ) {
          return Effect.void;
        }
        const existingSummary = Option.getOrUndefined(existingEntry);
        const parts = new Map(existingSummary?.parts ?? []);
        const otherChars = Array.from(parts.entries()).reduce(
          (total, [index, text]) => total + (index === summaryIndex ? 0 : text.length),
          0,
        );
        const partLimit = Math.max(0, MAX_BUFFERED_REASONING_SUMMARY_CHARS - otherChars);
        if (partLimit === 0) return Effect.void;
        parts.set(
          summaryIndex,
          appendCappedBufferedText(parts.get(summaryIndex) ?? "", delta, partLimit),
        );
        return Cache.set(input.state.bufferedReasoningSummaryByKey, key, {
          parts,
          sourceEvent: event,
        });
      }),
    );

  const takeBufferedReasoningSummary = (key: string) =>
    Cache.getOption(input.state.bufferedReasoningSummaryByKey, key).pipe(
      Effect.flatMap((entry) =>
        Cache.invalidate(input.state.bufferedReasoningSummaryByKey, key).pipe(
          Effect.as(Option.getOrUndefined(entry)),
        ),
      ),
    );

  const settleBufferedReasoningSummaries = (
    threadId: ThreadId,
    terminalEvent: ProviderRuntimeEvent,
    turnId?: TurnId,
  ) => {
    const prefix = turnId ? `${threadId}:${turnId}:` : `${threadId}:`;
    return Cache.keys(input.state.bufferedReasoningSummaryByKey).pipe(
      Effect.flatMap((keys) =>
        Effect.forEach(
          Array.from(keys).filter((key) => key.startsWith(prefix)),
          (key) =>
            takeBufferedReasoningSummary(key).pipe(
              Effect.flatMap((summary) => {
                const detail = joinedBufferedReasoningSummary(summary);
                if (!summary || !detail || !summary.sourceEvent.itemId) return Effect.void;
                const completionEvent: ProviderRuntimeEvent = {
                  ...summary.sourceEvent,
                  eventId: EventId.makeUnsafe(
                    `${terminalEvent.eventId}:reasoning:${summary.sourceEvent.itemId}`,
                  ),
                  threadId,
                  type: "item.completed",
                  payload: {
                    itemType: "reasoning",
                    status: bufferedReasoningTerminalStatus(terminalEvent),
                    title: "Reasoning",
                    detail,
                  },
                };
                return Effect.forEach(
                  runtimeEventToActivities(completionEvent),
                  (activity) => input.dispatchActivityUpdate(completionEvent, threadId, activity),
                  { concurrency: 1 },
                ).pipe(Effect.asVoid);
              }),
            ),
          { concurrency: 1 },
        ).pipe(Effect.asVoid),
      ),
    );
  };

  return {
    appendBufferedProposedPlan,
    takeBufferedProposedPlan,
    clearBufferedProposedPlan,
    appendBufferedToolOutput,
    getBufferedToolOutput,
    takeBufferedToolOutput,
    appendBufferedReasoningSummary,
    takeBufferedReasoningSummary,
    settleBufferedReasoningSummaries,
  };
}
