import {
  MessageId,
  type OrchestrationThread,
  type ThreadId,
  type TurnId,
} from "@agent-group/contracts";
import { Cause, Effect, Schema } from "effect";

import { checkpointRefForThreadMessageStart } from "../../checkpointing/Utils.ts";
import type { CheckpointStoreShape } from "../../checkpointing/Services/CheckpointStore.ts";
import { ProviderAdapterRequestError, type ProviderServiceError } from "../../provider/Errors.ts";
import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import { buildPriorTranscriptBootstrapText } from "../handoff.ts";
import type { StudioOutputReactorShape } from "../Services/StudioOutputReactor.ts";
import type { EnsureProviderSessionOptions } from "./providerSessionCoordinator.ts";
import {
  type PendingAgentGroupTurnAttempt,
  type PendingContextBootstrapAttempt,
  type ProviderTurnBootstrapState,
} from "./providerTurnBootstrapState.ts";
import {
  type PreparedProviderTurn,
  type ProviderTurnDispatchInput,
} from "./providerTurnPreparation.ts";
import {
  normalizeSkillMentionTextForProvider,
  toNonEmptyProviderInput,
  wrapProviderContext,
} from "./providerTurnPrompt.ts";

export interface ProviderTurnDispatchResult {
  readonly dispatchedTurnId: TurnId | null;
  readonly pendingContextBootstrapAttempt: PendingContextBootstrapAttempt | undefined;
  readonly pendingAgentGroupTurnAttempt: PendingAgentGroupTurnAttempt | undefined;
}

function isStaleClaudeResumeError(error: unknown): boolean {
  if (Schema.is(ProviderAdapterRequestError)(error)) {
    return (
      error.provider === "claudeAgent" &&
      error.detail.toLowerCase().includes("no conversation found with session id")
    );
  }
  return String(error).toLowerCase().includes("no conversation found with session id");
}

/** Owns pre-turn baselines and provider review/steer/send execution. */
export function makeProviderTurnDispatcher<ResolveError, ClearError, EnsureError>(dependencies: {
  readonly providerService: ProviderServiceShape;
  readonly checkpointStore: CheckpointStoreShape;
  readonly studioOutputReactor: StudioOutputReactorShape;
  readonly bootstrapState: ProviderTurnBootstrapState;
  readonly resolveThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThread | undefined, ResolveError>;
  readonly resolveProjectedThreadWorkspaceCwd: (
    thread: Pick<OrchestrationThread, "projectId">,
  ) => Effect.Effect<string | undefined, ResolveError>;
  readonly clearStaleProviderResumeState: (input: {
    readonly threadId: ThreadId;
    readonly cause: ProviderServiceError;
  }) => Effect.Effect<unknown, ClearError>;
  readonly ensureSessionForThread: (
    threadId: ThreadId,
    createdAt: string,
    options?: EnsureProviderSessionOptions,
  ) => Effect.Effect<unknown, EnsureError>;
}) {
  const dispatch = Effect.fnUntraced(function* (input: {
    readonly request: ProviderTurnDispatchInput;
    readonly prepared: PreparedProviderTurn;
  }): Effect.fn.Return<
    ProviderTurnDispatchResult,
    ProviderServiceError | ResolveError | ClearError | EnsureError
  > {
    const request = input.request;
    const prepared = input.prepared;
    const sendQueuedProviderTurn = (messageText: string | undefined) =>
      dependencies.providerService.sendTurn({
        threadId: request.threadId,
        ...(messageText ? { input: messageText } : {}),
        ...(prepared.normalizedAttachments.length > 0
          ? { attachments: prepared.normalizedAttachments }
          : {}),
        ...(request.skills !== undefined ? { skills: request.skills } : {}),
        ...(prepared.providerMentions && prepared.providerMentions.length > 0
          ? { mentions: prepared.providerMentions }
          : {}),
        ...(prepared.modelForTurn ? { modelSelection: prepared.modelForTurn } : {}),
        ...(request.interactionMode !== undefined
          ? { interactionMode: request.interactionMode }
          : {}),
      });

    const captureMessageStartCheckpoint = Effect.gen(function* () {
      if ((request.dispatchMode ?? "queue") === "steer") return;
      const currentThread = yield* dependencies.resolveThread(request.threadId);
      if (!currentThread) return;
      const cwd = yield* dependencies.resolveProjectedThreadWorkspaceCwd(currentThread);
      if (!cwd || !(yield* dependencies.checkpointStore.isGitRepository(cwd))) return;
      yield* dependencies.checkpointStore.captureCheckpoint({
        cwd,
        checkpointRef: checkpointRefForThreadMessageStart(
          request.threadId,
          MessageId.makeUnsafe(request.messageId),
        ),
        skipIfExists: true,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to capture provider turn start checkpoint", {
          threadId: request.threadId,
          messageId: request.messageId,
          cause: Cause.pretty(cause),
        }),
      ),
    );
    const capturePreTurnBaselines = Effect.all(
      [
        captureMessageStartCheckpoint,
        dependencies.studioOutputReactor.captureBaselineBeforeTurn(request.threadId),
      ],
      { concurrency: 2, discard: true },
    );
    const cancelPendingStudioBaseline = dependencies.studioOutputReactor.cancelPendingTurnBaseline(
      request.threadId,
    );
    let pendingContextBootstrapAttempt: PendingContextBootstrapAttempt | undefined;
    let dispatchedTurnId: TurnId | null = null;
    const pendingAgentGroupTurnAttempt: PendingAgentGroupTurnAttempt | undefined =
      prepared.agentGroupCoordinates && prepared.agentGroupTurn ? {} : undefined;
    if (pendingAgentGroupTurnAttempt) {
      dependencies.bootstrapState.setAgentGroupAttempt(
        request.threadId,
        pendingAgentGroupTurnAttempt,
      );
    }
    const clearPendingAgentGroupTurnAttempt = () => {
      if (pendingAgentGroupTurnAttempt) {
        dependencies.bootstrapState.clearAgentGroupAttempt(
          request.threadId,
          pendingAgentGroupTurnAttempt,
        );
      }
    };

    if (request.reviewTarget !== undefined) {
      yield* capturePreTurnBaselines;
      yield* dependencies.providerService
        .startReview({ threadId: request.threadId, target: request.reviewTarget })
        .pipe(Effect.onError(() => cancelPendingStudioBaseline));
    } else if (request.dispatchMode === "steer") {
      const steeredTurn = yield* dependencies.providerService
        .steerTurn({
          threadId: request.threadId,
          ...(prepared.normalizedInput ? { input: prepared.normalizedInput } : {}),
          ...(prepared.normalizedAttachments.length > 0
            ? { attachments: prepared.normalizedAttachments }
            : {}),
          ...(request.skills !== undefined ? { skills: request.skills } : {}),
          ...(prepared.providerMentions && prepared.providerMentions.length > 0
            ? { mentions: prepared.providerMentions }
            : {}),
          ...(prepared.modelForTurn ? { modelSelection: prepared.modelForTurn } : {}),
          ...(request.interactionMode !== undefined
            ? { interactionMode: request.interactionMode }
            : {}),
        })
        .pipe(Effect.onError(() => Effect.sync(clearPendingAgentGroupTurnAttempt)));
      dispatchedTurnId = steeredTurn.turnId;
    } else {
      yield* capturePreTurnBaselines;
      pendingContextBootstrapAttempt =
        prepared.activeSession?.provider === "droid" &&
        (prepared.sidechatBootstrapText !== null || prepared.priorTranscriptBootstrapText !== null)
          ? {
              clearSidechat: prepared.sidechatBootstrapText !== null,
              clearPriorTranscript: prepared.priorTranscriptBootstrapText !== null,
            }
          : undefined;
      if (pendingContextBootstrapAttempt) {
        dependencies.bootstrapState.setContextAttempt(
          request.threadId,
          pendingContextBootstrapAttempt,
        );
      }
      const sentTurn = yield* sendQueuedProviderTurn(prepared.normalizedInput).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            if (prepared.selectedProvider !== "claudeAgent" || !isStaleClaudeResumeError(error)) {
              return yield* Effect.fail(error);
            }
            yield* dependencies.clearStaleProviderResumeState({
              threadId: request.threadId,
              cause: error,
            });
            yield* dependencies.ensureSessionForThread(request.threadId, request.createdAt, {
              ...(request.modelSelection !== undefined
                ? { modelSelection: request.modelSelection }
                : {}),
              ...(request.providerOptions !== undefined
                ? { providerOptions: request.providerOptions }
                : {}),
              ...(request.runtimeMode !== undefined ? { runtimeMode: request.runtimeMode } : {}),
            });
            const retryBootstrapText =
              prepared.agentGroupTurn === null &&
              prepared.priorTranscriptBootstrapAvailableChars > 0
                ? buildPriorTranscriptBootstrapText(
                    prepared.thread,
                    request.messageId,
                    prepared.priorTranscriptBootstrapAvailableChars,
                  )
                : null;
            const retryProviderInput = retryBootstrapText
              ? wrapProviderContext({
                  tag: "thread_context",
                  contextText: retryBootstrapText,
                  messageText: prepared.boundaryMessageText,
                  wrapLatestUserMessage: true,
                })
              : prepared.boundaryMessageText;
            const retryProviderInputWithSkills = prepared.skillInlineText
              ? `${retryProviderInput}\n\n${prepared.skillInlineText}`
              : retryProviderInput;
            const retryNormalizedInput = toNonEmptyProviderInput(
              normalizeSkillMentionTextForProvider({
                provider: prepared.selectedProvider,
                messageText: retryProviderInputWithSkills,
                ...(request.skills !== undefined ? { skills: request.skills } : {}),
              }),
            );
            yield* Effect.logWarning(
              "provider command reactor retrying claude turn after stale resume",
              {
                threadId: request.threadId,
                messageId: request.messageId,
                bootstrappedPriorTranscript: retryBootstrapText !== null,
              },
            );
            return yield* sendQueuedProviderTurn(retryNormalizedInput);
          }),
        ),
        Effect.onError(() =>
          Effect.gen(function* () {
            yield* Effect.sync(() => {
              clearPendingAgentGroupTurnAttempt();
              if (
                pendingContextBootstrapAttempt &&
                dependencies.bootstrapState.isCurrentContextAttempt(
                  request.threadId,
                  pendingContextBootstrapAttempt,
                )
              ) {
                dependencies.bootstrapState.removeContextAttempt(request.threadId);
              }
            });
            yield* cancelPendingStudioBaseline;
          }),
        ),
      );
      dispatchedTurnId = sentTurn.turnId;
      if (pendingContextBootstrapAttempt) {
        pendingContextBootstrapAttempt.turnId = sentTurn.turnId;
        const terminalEvent = pendingContextBootstrapAttempt.terminalEvent;
        if (terminalEvent?.turnId === sentTurn.turnId) {
          dependencies.bootstrapState.removeContextAttempt(request.threadId);
          dependencies.bootstrapState.completeContextAttempt(
            request.threadId,
            pendingContextBootstrapAttempt,
            terminalEvent,
          );
        }
      }
    }

    return {
      dispatchedTurnId,
      pendingContextBootstrapAttempt,
      pendingAgentGroupTurnAttempt,
    };
  });

  return { dispatch } as const;
}
