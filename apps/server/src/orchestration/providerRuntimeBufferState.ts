import {
  type AssistantDeliveryMode,
  type MessageId,
  type ProviderRuntimeEvent,
  type CheckpointRef,
} from "@agent-group/contracts";
import { Cache, Duration, Effect, Ref } from "effect";

import { parseCheckpointFilesFromUnifiedDiff } from "../checkpointing/Diffs.ts";
import { DEFAULT_ASSISTANT_DELIVERY_MODE } from "./providerRuntimeIngestionValues.ts";

export interface BufferedToolOutput {
  readonly text: string;
  readonly truncated: boolean;
}

export interface BufferedReasoningSummary {
  readonly parts: ReadonlyMap<number, string>;
  readonly sourceEvent: Extract<ProviderRuntimeEvent, { readonly type: "content.delta" }>;
}

export interface ProviderDiffPlaceholder {
  readonly checkpointRef: CheckpointRef;
  readonly checkpointTurnCount: number;
  readonly files: ReadonlyArray<ReturnType<typeof parseCheckpointFilesFromUnifiedDiff>[number]>;
}

export interface ProviderRuntimeBufferState {
  readonly assistantDeliveryModeRef: Ref.Ref<AssistantDeliveryMode>;
  readonly turnMessageIdsByTurnKey: Cache.Cache<string, Set<MessageId>>;
  readonly bufferedAssistantTextByMessageId: Cache.Cache<MessageId, string>;
  readonly bufferedProposedPlanById: Cache.Cache<string, { text: string; createdAt: string }>;
  readonly bufferedToolOutputByKey: Cache.Cache<string, BufferedToolOutput | undefined>;
  readonly bufferedReasoningSummaryByKey: Cache.Cache<string, BufferedReasoningSummary | undefined>;
  readonly pendingGeneratedImagesByTurnKey: Cache.Cache<string, ReadonlyArray<string>>;
  readonly latestActivityUpdateFingerprintByKey: Cache.Cache<string, string | undefined>;
  readonly providerDiffPlaceholdersRef: Ref.Ref<Map<string, ProviderDiffPlaceholder>>;
}

export const makeProviderRuntimeBufferState: Effect.Effect<ProviderRuntimeBufferState> = Effect.gen(
  function* () {
    const assistantDeliveryModeRef = yield* Ref.make<AssistantDeliveryMode>(
      DEFAULT_ASSISTANT_DELIVERY_MODE,
    );
    const turnMessageIdsByTurnKey = yield* Cache.make<string, Set<MessageId>>({
      capacity: 2_048,
      timeToLive: Duration.minutes(60),
      lookup: () => Effect.succeed(new Set<MessageId>()),
    });
    const bufferedAssistantTextByMessageId = yield* Cache.make<MessageId, string>({
      capacity: 1_024,
      timeToLive: Duration.minutes(60),
      lookup: () => Effect.succeed(""),
    });
    const bufferedProposedPlanById = yield* Cache.make<string, { text: string; createdAt: string }>(
      {
        capacity: 1_024,
        timeToLive: Duration.minutes(60),
        lookup: () => Effect.succeed({ text: "", createdAt: "" }),
      },
    );
    const bufferedToolOutputByKey = yield* Cache.make<string, BufferedToolOutput | undefined>({
      capacity: 2_048,
      timeToLive: Duration.minutes(60),
      lookup: () => Effect.succeed(undefined),
    });
    const bufferedReasoningSummaryByKey = yield* Cache.make<
      string,
      BufferedReasoningSummary | undefined
    >({
      capacity: 2_048,
      timeToLive: Duration.minutes(60),
      lookup: () => Effect.succeed(undefined),
    });
    const pendingGeneratedImagesByTurnKey = yield* Cache.make<string, ReadonlyArray<string>>({
      capacity: 512,
      timeToLive: Duration.minutes(60),
      lookup: () => Effect.succeed([]),
    });
    const latestActivityUpdateFingerprintByKey = yield* Cache.make<string, string | undefined>({
      capacity: 4_096,
      timeToLive: Duration.minutes(360),
      lookup: () => Effect.succeed(undefined),
    });
    const providerDiffPlaceholdersRef = yield* Ref.make(new Map<string, ProviderDiffPlaceholder>());
    return {
      assistantDeliveryModeRef,
      turnMessageIdsByTurnKey,
      bufferedAssistantTextByMessageId,
      bufferedProposedPlanById,
      bufferedToolOutputByKey,
      bufferedReasoningSummaryByKey,
      pendingGeneratedImagesByTurnKey,
      latestActivityUpdateFingerprintByKey,
      providerDiffPlaceholdersRef,
    };
  },
);
