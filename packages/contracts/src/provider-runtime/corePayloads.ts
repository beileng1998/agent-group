import { Schema } from "effect";
import { NonNegativeInt, PositiveInt } from "../baseSchemas";
import {
  CanonicalItemType,
  RuntimeContentStreamKind,
  RuntimeItemStatus,
  RuntimeSessionExitKind,
  RuntimeSessionState,
  RuntimeTaskStatus,
  RuntimeThreadState,
  RuntimeTurnState,
  TrimmedNonEmptyStringSchema,
  UnknownRecordSchema,
} from "./references";

export const SessionStartedPayload = Schema.Struct({
  message: Schema.optional(TrimmedNonEmptyStringSchema),
  resume: Schema.optional(Schema.Unknown),
});
export type SessionStartedPayload = typeof SessionStartedPayload.Type;

export const SessionConfiguredPayload = Schema.Struct({ config: UnknownRecordSchema });
export type SessionConfiguredPayload = typeof SessionConfiguredPayload.Type;

export const SessionStateChangedPayload = Schema.Struct({
  state: RuntimeSessionState,
  reason: Schema.optional(TrimmedNonEmptyStringSchema),
  detail: Schema.optional(Schema.Unknown),
});
export type SessionStateChangedPayload = typeof SessionStateChangedPayload.Type;

export const SessionExitedPayload = Schema.Struct({
  reason: Schema.optional(TrimmedNonEmptyStringSchema),
  recoverable: Schema.optional(Schema.Boolean),
  exitKind: Schema.optional(RuntimeSessionExitKind),
});
export type SessionExitedPayload = typeof SessionExitedPayload.Type;

export const ThreadStartedPayload = Schema.Struct({
  providerThreadId: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type ThreadStartedPayload = typeof ThreadStartedPayload.Type;

export const ThreadStateChangedPayload = Schema.Struct({
  state: RuntimeThreadState,
  detail: Schema.optional(Schema.Unknown),
});
export type ThreadStateChangedPayload = typeof ThreadStateChangedPayload.Type;

export const ThreadMetadataUpdatedPayload = Schema.Struct({
  name: Schema.optional(TrimmedNonEmptyStringSchema),
  metadata: Schema.optional(UnknownRecordSchema),
});
export type ThreadMetadataUpdatedPayload = typeof ThreadMetadataUpdatedPayload.Type;

export const ThreadTokenUsageSnapshot = Schema.Struct({
  usedTokens: NonNegativeInt,
  usedPercent: Schema.optional(
    Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(100)),
  ),
  totalProcessedTokens: Schema.optional(NonNegativeInt),
  maxTokens: Schema.optional(PositiveInt),
  inputTokens: Schema.optional(NonNegativeInt),
  cachedInputTokens: Schema.optional(NonNegativeInt),
  outputTokens: Schema.optional(NonNegativeInt),
  reasoningOutputTokens: Schema.optional(NonNegativeInt),
  lastUsedTokens: Schema.optional(NonNegativeInt),
  lastInputTokens: Schema.optional(NonNegativeInt),
  lastCachedInputTokens: Schema.optional(NonNegativeInt),
  lastOutputTokens: Schema.optional(NonNegativeInt),
  lastReasoningOutputTokens: Schema.optional(NonNegativeInt),
  toolUses: Schema.optional(NonNegativeInt),
  durationMs: Schema.optional(NonNegativeInt),
  compactsAutomatically: Schema.optional(Schema.Boolean),
});
export type ThreadTokenUsageSnapshot = typeof ThreadTokenUsageSnapshot.Type;

export const ThreadTokenUsageUpdatedPayload = Schema.Struct({ usage: ThreadTokenUsageSnapshot });
export type ThreadTokenUsageUpdatedPayload = typeof ThreadTokenUsageUpdatedPayload.Type;

export const ThreadRealtimeStartedPayload = Schema.Struct({
  realtimeSessionId: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type ThreadRealtimeStartedPayload = typeof ThreadRealtimeStartedPayload.Type;

export const ThreadRealtimeItemAddedPayload = Schema.Struct({ item: Schema.Unknown });
export type ThreadRealtimeItemAddedPayload = typeof ThreadRealtimeItemAddedPayload.Type;

export const ThreadRealtimeAudioDeltaPayload = Schema.Struct({ audio: Schema.Unknown });
export type ThreadRealtimeAudioDeltaPayload = typeof ThreadRealtimeAudioDeltaPayload.Type;

export const ThreadRealtimeErrorPayload = Schema.Struct({ message: TrimmedNonEmptyStringSchema });
export type ThreadRealtimeErrorPayload = typeof ThreadRealtimeErrorPayload.Type;

export const ThreadRealtimeClosedPayload = Schema.Struct({
  reason: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type ThreadRealtimeClosedPayload = typeof ThreadRealtimeClosedPayload.Type;

export const TurnStartedPayload = Schema.Struct({
  model: Schema.optional(TrimmedNonEmptyStringSchema),
  effort: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type TurnStartedPayload = typeof TurnStartedPayload.Type;

export const TurnCompletedPayload = Schema.Struct({
  state: RuntimeTurnState,
  stopReason: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
  usage: Schema.optional(Schema.Unknown),
  modelUsage: Schema.optional(UnknownRecordSchema),
  totalCostUsd: Schema.optional(Schema.Number),
  cumulativeCostUsd: Schema.optional(Schema.Number),
  errorMessage: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type TurnCompletedPayload = typeof TurnCompletedPayload.Type;

export const TurnAbortedPayload = Schema.Struct({ reason: TrimmedNonEmptyStringSchema });
export type TurnAbortedPayload = typeof TurnAbortedPayload.Type;

export const RuntimeTaskListItem = Schema.Struct({
  task: TrimmedNonEmptyStringSchema,
  status: RuntimeTaskStatus,
});
export type RuntimeTaskListItem = typeof RuntimeTaskListItem.Type;

export const TurnTasksUpdatedPayload = Schema.Struct({
  explanation: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
  tasks: Schema.Array(RuntimeTaskListItem),
});
export type TurnTasksUpdatedPayload = typeof TurnTasksUpdatedPayload.Type;

export const TurnProposedDeltaPayload = Schema.Struct({ delta: Schema.String });
export type TurnProposedDeltaPayload = typeof TurnProposedDeltaPayload.Type;

export const TurnProposedCompletedPayload = Schema.Struct({
  planMarkdown: TrimmedNonEmptyStringSchema,
});
export type TurnProposedCompletedPayload = typeof TurnProposedCompletedPayload.Type;

export const TurnDiffUpdatedPayload = Schema.Struct({ unifiedDiff: Schema.String });
export type TurnDiffUpdatedPayload = typeof TurnDiffUpdatedPayload.Type;

export const ItemLifecyclePayload = Schema.Struct({
  itemType: CanonicalItemType,
  status: Schema.optional(RuntimeItemStatus),
  title: Schema.optional(TrimmedNonEmptyStringSchema),
  detail: Schema.optional(TrimmedNonEmptyStringSchema),
  data: Schema.optional(Schema.Unknown),
});
export type ItemLifecyclePayload = typeof ItemLifecyclePayload.Type;

// Codex-generated images are persisted as local file references, never inline bytes.
export const CODEX_GENERATED_IMAGE_ARTIFACT_KIND = "codex.generated_image" as const;
export const CodexGeneratedImageArtifact = Schema.Struct({
  kind: Schema.Literal(CODEX_GENERATED_IMAGE_ARTIFACT_KIND),
  path: TrimmedNonEmptyStringSchema,
  callId: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type CodexGeneratedImageArtifact = typeof CodexGeneratedImageArtifact.Type;

export const ContentDeltaPayload = Schema.Struct({
  streamKind: RuntimeContentStreamKind,
  delta: Schema.String,
  contentIndex: Schema.optional(Schema.Int),
  summaryIndex: Schema.optional(Schema.Int),
});
export type ContentDeltaPayload = typeof ContentDeltaPayload.Type;
