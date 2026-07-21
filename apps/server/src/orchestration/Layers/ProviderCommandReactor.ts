// FILE: ProviderCommandReactor.ts

import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  type ProviderStartOptions,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  ThreadId,
  TurnId,
} from "@agent-group/contracts";
import { Cache, Cause, Duration, Effect, Layer, Option, Stream } from "effect";
import { makeDrainableWorker } from "@agent-group/shared/DrainableWorker";

import { CheckpointStore } from "../../checkpointing/Services/CheckpointStore.ts";
import { markAgentGroupTurnStarted } from "../../agentGroup/runtime.ts";
import { ServerConfig } from "../../config.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { TextGeneration } from "../../git/Services/TextGeneration.ts";
import { resolveTextGenerationInputForSelection } from "../../git/textGenerationSelection.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ProviderCommandReactor,
  type ProviderCommandReactorShape,
} from "../Services/ProviderCommandReactor.ts";
import { StudioOutputReactor } from "../Services/StudioOutputReactor.ts";
import { makeProviderSessionCoordinator } from "./providerSessionCoordinator.ts";
import { ProviderTurnQueue } from "./providerTurnQueue.ts";
import { makeProviderFirstTurnMetadata } from "./providerFirstTurnMetadata.ts";
import {
  type PendingAgentGroupTurnAttempt,
  type ProviderQueueDrainEvent,
  ProviderTurnBootstrapState,
} from "./providerTurnBootstrapState.ts";
import {
  makeProviderTurnPreparation,
  type ProviderTurnDispatchInput,
} from "./providerTurnPreparation.ts";
import { makeProviderTurnDispatcher } from "./providerTurnDispatcher.ts";
import { makeProviderConversationRollback } from "./providerConversationRollback.ts";
import { makeProviderMessageEdit } from "./providerMessageEdit.ts";
import { makeProviderInteractionHandlers } from "./providerInteractionHandlers.ts";
import { makeProviderTurnAdmission } from "./providerTurnAdmission.ts";
import { ProviderSessionSelectionState } from "./providerSessionSelectionState.ts";
import {
  isProviderIntentEvent,
  makeProviderIntentRouter,
  type ProviderIntentEvent,
} from "./providerIntentRouter.ts";
import { makeProviderAgentGroupBridge } from "./providerAgentGroupBridge.ts";
import { makeProviderThreadRouting } from "./providerThreadRouting.ts";
import { makeProviderProjectionWriter } from "./providerProjectionWriter.ts";
import { makeProviderResumeRecovery } from "./providerResumeRecovery.ts";

export { normalizeSkillMentionTextForProvider } from "./providerTurnPrompt.ts";

const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

const HANDLED_TURN_START_KEY_MAX = 10_000;
const HANDLED_TURN_START_KEY_TTL = Duration.minutes(30);
const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const checkpointStore = yield* CheckpointStore;
  const studioOutputReactor = yield* StudioOutputReactor;
  const git = yield* GitCore;
  const textGeneration = yield* TextGeneration;
  const serverSettings = yield* ServerSettingsService;
  const serverConfig = yield* ServerConfig;
  const handledTurnStartKeys = yield* Cache.make<string, true>({
    capacity: HANDLED_TURN_START_KEY_MAX,
    timeToLive: HANDLED_TURN_START_KEY_TTL,
    lookup: () => Effect.succeed(true),
  });

  const hasHandledTurnStartRecently = (key: string) =>
    Cache.getOption(handledTurnStartKeys, key).pipe(
      Effect.flatMap((cached) =>
        Cache.set(handledTurnStartKeys, key, true).pipe(Effect.as(Option.isSome(cached))),
      ),
    );

  const selectionState = new ProviderSessionSelectionState();
  const seedThreadModelSelections = projectionSnapshotQuery.getCommandReadModel().pipe(
    Effect.tap((snapshot) =>
      Effect.sync(() => {
        selectionState.seed(snapshot.threads);
      }),
    ),
    Effect.catchCause((cause) =>
      Effect.logWarning("provider command reactor failed to seed model selections", {
        cause: Cause.pretty(cause),
      }),
    ),
  );

  const resolveThreadWorkspaceProject = Effect.fnUntraced(function* (
    thread: Pick<OrchestrationThread, "projectId">,
  ): Effect.fn.Return<OrchestrationProjectShell | undefined> {
    return Option.getOrUndefined(
      yield* projectionSnapshotQuery
        .getProjectShellById(thread.projectId)
        .pipe(Effect.catch(() => Effect.succeed(Option.none()))),
    );
  });

  const resolveProjectedThreadWorkspaceCwd = Effect.fnUntraced(function* (
    thread: Pick<OrchestrationThread, "projectId">,
  ): Effect.fn.Return<string | undefined> {
    const project = yield* resolveThreadWorkspaceProject(thread);
    return project?.workspaceRoot;
  });
  const turnQueue = new ProviderTurnQueue();
  // Threads with a drained queued turn whose `thread.turn-start-requested` has
  // been dispatched into the engine but not yet processed by the worker. While
  // set, recovery drains and terminal-event drains must hold off so two queued
  // turns are never promoted at once.
  const bootstrapState = new ProviderTurnBootstrapState();
  const resolveThreadTextGenerationInput = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly modelSelection?: ModelSelection;
    readonly providerOptions?: ProviderStartOptions;
    readonly useConfiguredFallback?: boolean;
  }) {
    const thread = yield* resolveThread(input.threadId);
    const modelSelection =
      input.modelSelection ??
      thread?.modelSelection ??
      selectionState.getModelSelection(input.threadId);
    const providerOptions =
      input.providerOptions ?? selectionState.getProviderOptions(input.threadId);
    const threadTextGenerationInput = resolveTextGenerationInputForSelection(
      modelSelection,
      providerOptions,
    );

    if (threadTextGenerationInput || !input.useConfiguredFallback) {
      return threadTextGenerationInput;
    }

    // Non-generating chat providers still get AI titles via the configured git-writing model.
    const settings = yield* serverSettings.getSettings;
    return resolveTextGenerationInputForSelection(
      settings.textGenerationModelSelection,
      providerOptions,
    );
  });

  const resolveThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    return Option.getOrUndefined(yield* projectionSnapshotQuery.getThreadDetailById(threadId));
  });
  const { appendProviderFailureActivity, setThreadSession, setThreadSessionError } =
    makeProviderProjectionWriter({ orchestrationEngine, resolveThread, serverCommandId });

  const { ensureSessionForThread } = makeProviderSessionCoordinator({
    providerService,
    resolveThread,
    resolveProjectedThreadWorkspaceCwd,
    setThreadSession,
    state: {
      selectionState,
      bootstrapState,
    },
  });

  const {
    maybeGenerateAndRenameThreadTitleForFirstTurn,
    maybeGenerateAndRenameWorktreeBranchForFirstTurn,
  } = makeProviderFirstTurnMetadata({
    orchestrationEngine,
    git,
    textGeneration,
    resolveThread,
    resolveProjectedThreadWorkspaceCwd,
    resolveThreadTextGenerationInput,
    serverCommandId,
  });

  const {
    finalizeAgentGroupContextTurn,
    resolveAgentGroupCoordinates,
    resolveMentionedAgentGroupSessions,
  } = makeProviderAgentGroupBridge({
    providerService,
    projectionSnapshotQuery,
    resolveThread,
    resolveThreadWorkspaceProject,
    appendFinalizeFailure: (input) =>
      appendProviderFailureActivity({
        ...input,
        kind: "agent-group.context.finalize.failed",
        summary: "Session context could not be finalized",
      }),
  });

  const { prepare: prepareProviderTurn } = makeProviderTurnPreparation({
    providerService,
    attachmentsDir: serverConfig.attachmentsDir,
    bootstrapState,
    resolveThread,
    resolveAgentGroupCoordinates,
    resolveMentionedAgentGroupSessions,
    getAgentGroupSettings: () =>
      serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.agentGroup),
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to load Agent Group prompt settings; using defaults", {
            cause: Cause.pretty(cause),
          }).pipe(Effect.as(DEFAULT_SERVER_SETTINGS.agentGroup)),
        ),
      ),
    ensureSessionForThread,
    getSessionModelSelection: (threadId) => selectionState.getModelSelection(threadId),
    recordProviderOptions: (threadId, options) => {
      selectionState.setProviderOptions(threadId, options);
    },
    recordModelSelection: (threadId, selection) => {
      selectionState.setModelSelection(threadId, selection);
    },
  });

  const { resolveProviderSessionThread, resolveSubagentProviderThreadId } =
    makeProviderThreadRouting({ projectionSnapshotQuery, resolveThread });

  const {
    interruptProviderTurn,
    processApprovalResponseRequested,
    processSessionStopRequested,
    processTurnInterruptRequested,
    processUserInputResponseRequested,
  } = makeProviderInteractionHandlers({
    providerService,
    bootstrapState,
    turnQueue,
    resolveThread,
    resolveProviderSessionThread,
    resolveSubagentProviderThreadId,
    appendProviderFailureActivity,
    setThreadSession,
  });

  const clearStaleProviderResumeState = makeProviderResumeRecovery(providerService);

  const {
    processConversationRollbackRequested,
    restoreWorkspaceBeforeEditReplay,
    rollbackProviderConversationForEdit,
  } = makeProviderConversationRollback({
    providerService,
    checkpointStore,
    orchestrationEngine,
    bootstrapState,
    resolveThread,
    resolveProviderSessionThread,
    resolveSubagentProviderThreadId,
    resolveProjectedThreadWorkspaceCwd,
    clearStaleProviderResumeState,
    serverCommandId,
  });

  const { processMessageEditResendRequested } = makeProviderMessageEdit({
    providerService,
    orchestrationEngine,
    bootstrapState,
    turnQueue,
    resolveThread,
    resolveProviderSessionThread,
    setThreadSession,
    rollbackProviderConversationForEdit,
    restoreWorkspaceBeforeEditReplay,
    serverCommandId,
  });

  const { dispatch: dispatchPreparedProviderTurn } = makeProviderTurnDispatcher({
    providerService,
    checkpointStore,
    studioOutputReactor,
    bootstrapState,
    resolveThread,
    resolveProjectedThreadWorkspaceCwd,
    clearStaleProviderResumeState,
    ensureSessionForThread,
  });

  const dispatchTurnForThread = Effect.fnUntraced(function* (input: ProviderTurnDispatchInput) {
    const prepared = yield* prepareProviderTurn(input);
    if (!prepared) return;
    const {
      thread,
      agentGroupCoordinates,
      agentGroupTurn,
      handoffBootstrapText,
      shouldBootstrapSidechatContext,
      sidechatBootstrapText,
      hasSidechatBootstrapContent,
      shouldBootstrapPriorTranscriptContext,
      priorTranscriptBootstrapText,
      hasPriorTranscriptBootstrapContent,
    } = prepared;
    const { dispatchedTurnId, pendingContextBootstrapAttempt, pendingAgentGroupTurnAttempt } =
      yield* dispatchPreparedProviderTurn({ request: input, prepared });
    const clearPendingAgentGroupTurnAttempt = () => {
      if (pendingAgentGroupTurnAttempt) {
        bootstrapState.clearAgentGroupAttempt(input.threadId, pendingAgentGroupTurnAttempt);
      }
    };
    if (agentGroupCoordinates && agentGroupTurn && dispatchedTurnId) {
      yield* Effect.tryPromise(() =>
        markAgentGroupTurnStarted(
          agentGroupCoordinates,
          dispatchedTurnId,
          agentGroupTurn.awarenessHead,
        ),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("agent group failed to record context turn start", {
            threadId: input.threadId,
            cause: Cause.pretty(cause),
          }),
        ),
      );
      if (pendingAgentGroupTurnAttempt) {
        pendingAgentGroupTurnAttempt.turnId = dispatchedTurnId;
        const terminalEvent = pendingAgentGroupTurnAttempt.terminalEvent;
        if (terminalEvent) {
          const terminalTurnId = terminalEvent.turnId ?? dispatchedTurnId;
          if (terminalTurnId === dispatchedTurnId) {
            clearPendingAgentGroupTurnAttempt();
          } else {
            delete pendingAgentGroupTurnAttempt.terminalEvent;
          }
          yield* finalizeAgentGroupContextTurn(terminalEvent, terminalTurnId);
          yield* drainQueuedTurnsForThread(input.threadId);
        }
      }
    }
    if (handoffBootstrapText && thread.handoff !== null && input.reviewTarget === undefined) {
      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: serverCommandId("handoff-bootstrap-complete"),
        threadId: input.threadId,
        handoff: {
          ...thread.handoff,
          bootstrapStatus: "completed",
        },
      });
    }
    if (
      shouldBootstrapSidechatContext &&
      input.reviewTarget === undefined &&
      pendingContextBootstrapAttempt === undefined &&
      (sidechatBootstrapText !== null || !hasSidechatBootstrapContent)
    ) {
      bootstrapState.clearSidechat(input.threadId);
    }
    if (
      shouldBootstrapPriorTranscriptContext &&
      input.reviewTarget === undefined &&
      pendingContextBootstrapAttempt === undefined &&
      (priorTranscriptBootstrapText !== null || !hasPriorTranscriptBootstrapContent)
    ) {
      bootstrapState.clearPriorTranscript(input.threadId);
    }
  });

  const drainQueuedTurnsForThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    if (!turnQueue.tryBeginDrain(threadId)) return;
    try {
      const nextQueuedTurn = turnQueue.dequeue(threadId);
      if (!nextQueuedTurn) {
        return;
      }
      turnQueue.markDispatchPending(threadId);
      yield* orchestrationEngine
        .dispatch({
          type: "thread.turn.dispatch-queued",
          commandId: serverCommandId("dispatch-queued-turn"),
          threadId,
          messageId: nextQueuedTurn.messageId,
          ...(nextQueuedTurn.modelSelection !== undefined
            ? { modelSelection: nextQueuedTurn.modelSelection }
            : {}),
          ...(nextQueuedTurn.providerOptions !== undefined
            ? { providerOptions: nextQueuedTurn.providerOptions }
            : {}),
          ...(nextQueuedTurn.reviewTarget !== undefined
            ? { reviewTarget: nextQueuedTurn.reviewTarget }
            : {}),
          ...(nextQueuedTurn.assistantDeliveryMode !== undefined
            ? { assistantDeliveryMode: nextQueuedTurn.assistantDeliveryMode }
            : {}),
          dispatchMode: nextQueuedTurn.dispatchMode,
          runtimeMode: nextQueuedTurn.runtimeMode,
          interactionMode: nextQueuedTurn.interactionMode,
          ...(nextQueuedTurn.sourceProposedPlan !== undefined
            ? { sourceProposedPlan: nextQueuedTurn.sourceProposedPlan }
            : {}),
          createdAt: nextQueuedTurn.createdAt,
        })
        .pipe(
          // A failed promotion must not leave the in-flight marker behind, or
          // every future drain for this thread would be blocked forever.
          Effect.onError(() => Effect.sync(() => turnQueue.clearDispatchPending(threadId))),
        );
    } finally {
      turnQueue.finishDrain(threadId);
    }
  });

  const { hasLiveProviderTurn, processTurnQueued, processTurnStartRequested } =
    makeProviderTurnAdmission({
      providerService,
      turnQueue,
      resolveThread,
      hasHandledTurnStartRecently,
      appendProviderFailureActivity,
      setThreadSession,
      setThreadSessionError,
      maybeGenerateAndRenameWorktreeBranchForFirstTurn,
      maybeGenerateAndRenameThreadTitleForFirstTurn,
      dispatchTurnForThread,
      interruptProviderTurn,
      drainQueuedTurnsForThread,
    });

  const processQueueDrainEvent = Effect.fnUntraced(function* (event: ProviderQueueDrainEvent) {
    bootstrapState.observeContextTerminalEvent(event);
    const agentGroupTurnId = bootstrapState.resolveAgentGroupTerminalTurnId(event);
    if (agentGroupTurnId === undefined) return;
    yield* finalizeAgentGroupContextTurn(event, agentGroupTurnId);
    yield* drainQueuedTurnsForThread(event.threadId);
  });

  const processDomainEvent = makeProviderIntentRouter({
    selectionState,
    resolveThread,
    ensureSessionForThread,
    hasLiveProviderTurn,
    setThreadSessionError,
    processTurnQueued,
    processTurnStartRequested,
    processTurnInterruptRequested,
    processApprovalResponseRequested,
    processUserInputResponseRequested,
    processConversationRollbackRequested,
    processMessageEditResendRequested,
    processSessionStopRequested,
  });

  const processDomainEventSafely = (event: ProviderIntentEvent) =>
    processDomainEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("provider command reactor failed to process event", {
          eventType: event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const processQueueDrainEventSafely = (event: ProviderQueueDrainEvent) =>
    processQueueDrainEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("provider command reactor failed to drain queued turn", {
          eventType: event.type,
          threadId: event.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processDomainEventSafely);

  const start: ProviderCommandReactorShape["start"] = seedThreadModelSelections.pipe(
    Effect.andThen(
      Effect.all([
        Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
          if (!isProviderIntentEvent(event)) return Effect.void;
          return worker.enqueue(event);
        }).pipe(Effect.forkScoped),
        Stream.runForEach(providerService.streamEvents, (event) => {
          if (event.type !== "turn.completed" && event.type !== "turn.aborted") {
            return Effect.void;
          }
          return processQueueDrainEventSafely(event);
        }).pipe(Effect.forkScoped),
      ]).pipe(Effect.asVoid),
    ),
  );

  return {
    start,
    drain: worker.drain,
  } satisfies ProviderCommandReactorShape;
});

export const ProviderCommandReactorLive = Layer.effect(ProviderCommandReactor, make);
