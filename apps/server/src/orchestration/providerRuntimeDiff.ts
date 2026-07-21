import {
  CheckpointRef,
  type OrchestrationThread,
  type ProviderRuntimeEvent,
} from "@agent-group/contracts";
import { Effect, Ref } from "effect";

import { parseCheckpointFilesFromUnifiedDiff } from "../checkpointing/Diffs.ts";
import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine.ts";
import type { ProviderRuntimeBufferState } from "./providerRuntimeBufferState.ts";
import { providerCommandId, providerTurnKey, toTurnId } from "./providerRuntimeIngestionValues.ts";

function parseProviderTurnDiffFiles(unifiedDiff: string) {
  try {
    return parseCheckpointFilesFromUnifiedDiff(unifiedDiff);
  } catch {
    return null;
  }
}

export function makeProviderRuntimeDiff(input: {
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly state: ProviderRuntimeBufferState;
  readonly isGitRepoForThread: (threadId: OrchestrationThread["id"]) => Effect.Effect<boolean>;
  readonly supportsLiveTurnDiffPatch: (
    provider: ProviderRuntimeEvent["provider"],
  ) => Effect.Effect<boolean>;
}) {
  const clearProviderDiffPlaceholder = (
    threadId: OrchestrationThread["id"],
    turnId: NonNullable<ReturnType<typeof toTurnId>>,
  ) =>
    Ref.update(input.state.providerDiffPlaceholdersRef, (placeholders) => {
      const next = new Map(placeholders);
      next.delete(providerTurnKey(threadId, turnId));
      return next;
    });

  const processTurnDiff = (event: ProviderRuntimeEvent, thread: OrchestrationThread) =>
    Effect.gen(function* () {
      if (event.type !== "turn.diff.updated") return;
      const turnId = toTurnId(event.turnId);
      if (!turnId || !(yield* input.isGitRepoForThread(thread.id))) return;
      const existingCheckpoint = thread.checkpoints.find((entry) => entry.turnId === turnId);
      const placeholderKey = providerTurnKey(thread.id, turnId);
      const tracked = (yield* Ref.get(input.state.providerDiffPlaceholdersRef)).get(placeholderKey);
      const existingProviderPlaceholder =
        existingCheckpoint?.checkpointRef.startsWith("provider-diff:") === true
          ? {
              checkpointRef: existingCheckpoint.checkpointRef,
              checkpointTurnCount: existingCheckpoint.checkpointTurnCount,
              files: existingCheckpoint.files,
            }
          : null;
      if (existingCheckpoint && !existingProviderPlaceholder) {
        yield* clearProviderDiffPlaceholder(thread.id, turnId);
        return;
      }
      const canParseLiveDiffPatch = yield* input.supportsLiveTurnDiffPatch(event.provider);
      const livePlaceholder = tracked ?? existingProviderPlaceholder;
      const maxTurnCount = thread.checkpoints.reduce(
        (max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount),
        0,
      );
      const files =
        (canParseLiveDiffPatch ? parseProviderTurnDiffFiles(event.payload.unifiedDiff) : null) ??
        tracked?.files ??
        existingCheckpoint?.files ??
        [];
      const checkpointRef =
        livePlaceholder?.checkpointRef ??
        CheckpointRef.makeUnsafe(`provider-diff:${event.eventId}`);
      const checkpointTurnCount = livePlaceholder?.checkpointTurnCount ?? maxTurnCount + 1;
      yield* input.orchestrationEngine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: providerCommandId(event, "thread-turn-diff-complete"),
        threadId: thread.id,
        turnId,
        completedAt: event.createdAt,
        checkpointRef,
        status: "missing",
        files,
        assistantMessageId: undefined,
        checkpointTurnCount,
        createdAt: event.createdAt,
      });
      if (canParseLiveDiffPatch) {
        yield* Ref.update(input.state.providerDiffPlaceholdersRef, (placeholders) => {
          const next = new Map(placeholders);
          next.set(placeholderKey, { checkpointRef, checkpointTurnCount, files });
          return next;
        });
      }
    });

  return { clearProviderDiffPlaceholder, processTurnDiff };
}
