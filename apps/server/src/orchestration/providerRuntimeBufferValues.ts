import { type ProviderRuntimeEvent, type ThreadId } from "@agent-group/contracts";

import type { BufferedReasoningSummary, BufferedToolOutput } from "./providerRuntimeBufferState.ts";

const BUFFERED_TEXT_TRUNCATION_MARKER = "... [truncated]";

export function appendCappedBufferedText(existing: string, delta: string, limit: number): string {
  const normalizedLimit = Math.max(0, Math.floor(limit));
  if (normalizedLimit === 0) return "";
  const next = `${existing}${delta}`;
  if (next.length <= normalizedLimit) return next;
  if (normalizedLimit <= BUFFERED_TEXT_TRUNCATION_MARKER.length) {
    return BUFFERED_TEXT_TRUNCATION_MARKER.slice(0, normalizedLimit);
  }
  return `${next.slice(
    0,
    normalizedLimit - BUFFERED_TEXT_TRUNCATION_MARKER.length,
  )}${BUFFERED_TEXT_TRUNCATION_MARKER}`;
}

export type ToolOutputStreamKind = "command_output" | "file_change_output";

export function toolOutputStreamKind(
  event: ProviderRuntimeEvent,
): ToolOutputStreamKind | undefined {
  if (event.type !== "content.delta") return undefined;
  return event.payload.streamKind === "command_output" ||
    event.payload.streamKind === "file_change_output"
    ? event.payload.streamKind
    : undefined;
}

export function toolOutputBufferKey(event: ProviderRuntimeEvent): string | null {
  if (!event.itemId) return null;
  return [event.threadId, event.turnId ?? "no-turn", event.itemId].join(":");
}

export function reasoningSummaryBufferKey(
  event: ProviderRuntimeEvent,
  threadId: ThreadId = event.threadId,
): string | null {
  if ((event.provider !== "codex" && event.provider !== "antigravity") || !event.itemId) {
    return null;
  }
  if (
    event.type === "content.delta" &&
    (event.payload.streamKind === "reasoning_summary_text" ||
      (event.provider === "antigravity" && event.payload.streamKind === "reasoning_text"))
  ) {
    return [threadId, event.turnId ?? "no-turn", event.itemId].join(":");
  }
  if (
    (event.type === "item.started" ||
      event.type === "item.updated" ||
      event.type === "item.completed") &&
    event.payload.itemType === "reasoning"
  ) {
    return [threadId, event.turnId ?? "no-turn", event.itemId].join(":");
  }
  return null;
}

function readableReasoningDetail(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.replace(/<!--[\s\S]*?-->/gu, "").trim().length === 0) {
    return undefined;
  }
  return trimmed;
}

export function joinedBufferedReasoningSummary(
  summary: BufferedReasoningSummary | undefined,
): string | undefined {
  if (!summary) return undefined;
  return readableReasoningDetail(
    Array.from(summary.parts.entries())
      .sort(([left], [right]) => left - right)
      .map(([, text]) => text.trim())
      .filter((text) => text.length > 0)
      .join("\n\n"),
  );
}

export function bufferedReasoningTerminalStatus(
  event: ProviderRuntimeEvent,
): "completed" | "failed" {
  if (event.type === "runtime.error" || event.type === "turn.aborted") return "failed";
  if (event.type === "turn.completed") {
    return event.payload.state === "completed" ? "completed" : "failed";
  }
  if (event.type === "session.exited") {
    return event.payload.exitKind === "error" ? "failed" : "completed";
  }
  return "completed";
}

export function withBufferedReasoningSummary(
  event: ProviderRuntimeEvent,
  summary: BufferedReasoningSummary | undefined,
): ProviderRuntimeEvent {
  if (
    event.type !== "item.completed" ||
    (event.provider !== "codex" && event.provider !== "antigravity") ||
    event.payload.itemType !== "reasoning" ||
    readableReasoningDetail(event.payload.detail)
  ) {
    return event;
  }
  const detail = joinedBufferedReasoningSummary(summary);
  if (!detail) return event;
  return { ...event, payload: { ...event.payload, detail } };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function mergeBufferedToolOutputData(
  data: unknown,
  bufferedOutput: BufferedToolOutput,
): Record<string, unknown> {
  const baseData = isJsonObject(data) ? data : {};
  const existingRawOutput = isJsonObject(baseData.rawOutput)
    ? baseData.rawOutput
    : typeof baseData.rawOutput === "string" && baseData.rawOutput.trim().length > 0
      ? { output: baseData.rawOutput }
      : {};
  const hasStructuredOutput =
    hasNonEmptyString(existingRawOutput.output) ||
    hasNonEmptyString(existingRawOutput.stdout) ||
    hasNonEmptyString(existingRawOutput.stderr);
  return {
    ...baseData,
    rawOutput: {
      ...existingRawOutput,
      ...(hasStructuredOutput ? {} : { output: bufferedOutput.text }),
      ...(bufferedOutput.truncated ? { truncated: true } : {}),
    },
  };
}

export function withBufferedToolOutputData(
  event: ProviderRuntimeEvent,
  bufferedOutput: BufferedToolOutput | undefined,
): ProviderRuntimeEvent {
  if (!bufferedOutput) return event;
  if (event.type !== "item.updated" && event.type !== "item.completed") return event;
  if (event.payload.itemType !== "command_execution" && event.payload.itemType !== "file_change") {
    return event;
  }
  return {
    ...event,
    payload: {
      ...event.payload,
      data: mergeBufferedToolOutputData(event.payload.data, bufferedOutput),
    },
  } as ProviderRuntimeEvent;
}
