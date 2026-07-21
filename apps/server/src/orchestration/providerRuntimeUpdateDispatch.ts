import {
  type OrchestrationThreadActivity,
  type ProviderRuntimeEvent,
  type ThreadId,
} from "@agent-group/contracts";
import { Cache, Effect, Option } from "effect";

import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine.ts";
import { stringifyJsonLike } from "./providerRuntimeActivityValues.ts";
import type { ProviderRuntimeBufferState } from "./providerRuntimeBufferState.ts";
import { providerCommandId } from "./providerRuntimeIngestionValues.ts";

function activityUpdateDedupeKey(
  event: ProviderRuntimeEvent,
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
): string | undefined {
  const prefix = `${threadId}:${event.provider}:${activity.kind}`;
  if (
    activity.kind === "context-window.updated" ||
    activity.kind === "account.rate-limits.updated"
  ) {
    return prefix;
  }
  const payload =
    activity.payload && typeof activity.payload === "object" && !Array.isArray(activity.payload)
      ? (activity.payload as Record<string, unknown>)
      : undefined;
  if (activity.kind === "task.progress") {
    const taskId = typeof payload?.taskId === "string" ? payload.taskId : undefined;
    return taskId ? `${prefix}:${taskId}` : undefined;
  }
  if (activity.kind !== "tool.updated") return undefined;
  const data =
    payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : undefined;
  const stringValue = (value: unknown) => (typeof value === "string" ? value : undefined);
  const toolUpdateId =
    event.itemId ??
    stringValue(data?.toolUseId) ??
    stringValue(data?.toolCallId) ??
    stringValue(data?.callId) ??
    stringValue(data?.callID);
  return toolUpdateId ? `${prefix}:${toolUpdateId}` : undefined;
}

function activityUpdateFingerprint(activity: OrchestrationThreadActivity): string {
  return stringifyJsonLike({
    kind: activity.kind,
    summary: activity.summary,
    payload: activity.payload,
    turnId: activity.turnId,
  });
}

export function makeProviderRuntimeUpdateDispatch(input: {
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly state: ProviderRuntimeBufferState;
}) {
  const dispatchActivityUpdate = Effect.fnUntraced(function* (
    event: ProviderRuntimeEvent,
    threadId: ThreadId,
    activity: OrchestrationThreadActivity,
  ) {
    const key = activityUpdateDedupeKey(event, threadId, activity);
    const fingerprint = key ? activityUpdateFingerprint(activity) : undefined;
    if (key && fingerprint) {
      const previous = yield* Cache.getOption(
        input.state.latestActivityUpdateFingerprintByKey,
        key,
      );
      if (Option.isSome(previous) && previous.value === fingerprint) return;
    }
    yield* input.orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: providerCommandId(event, "thread-activity-append"),
      threadId,
      activity,
      createdAt: activity.createdAt,
    });
    if (key && fingerprint) {
      yield* Cache.set(input.state.latestActivityUpdateFingerprintByKey, key, fingerprint);
    }
  });

  const clearActivityUpdateFingerprints = Effect.fnUntraced(function* (threadId: ThreadId) {
    const prefix = `${threadId}:`;
    const keys = Array.from(yield* Cache.keys(input.state.latestActivityUpdateFingerprintByKey));
    yield* Effect.forEach(
      keys,
      (key) =>
        key.startsWith(prefix)
          ? Cache.invalidate(input.state.latestActivityUpdateFingerprintByKey, key)
          : Effect.void,
      { concurrency: 1 },
    );
  });

  return { dispatchActivityUpdate, clearActivityUpdateFingerprints };
}
