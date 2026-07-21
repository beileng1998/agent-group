import {
  type ModelSelection,
  type OrchestrationSession,
  type OrchestrationThread,
  ProviderKind,
  type ProviderSession,
  type ProviderStartOptions,
  type RuntimeMode,
  type ThreadId,
} from "@agent-group/contracts";
import { claudeSelectionRequiresRestart } from "@agent-group/shared/model";
import { Effect, Equal, Schema } from "effect";

import type { ProviderServiceError } from "../../provider/Errors.ts";
import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import type { OrchestrationDispatchError } from "../Errors.ts";
import type { ProviderTurnBootstrapState } from "./providerTurnBootstrapState.ts";
import type { ProviderSessionSelectionState } from "./providerSessionSelectionState.ts";

export interface ProviderSessionCoordinatorState {
  readonly selectionState: ProviderSessionSelectionState;
  readonly bootstrapState: ProviderTurnBootstrapState;
}

export interface ProviderSessionCoordinatorDependencies<
  ResolveError = never,
  WorkspaceError = never,
> {
  readonly providerService: ProviderServiceShape;
  readonly state: ProviderSessionCoordinatorState;
  readonly resolveThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThread | undefined, ResolveError>;
  readonly resolveProjectedThreadWorkspaceCwd: (
    thread: Pick<OrchestrationThread, "projectId">,
  ) => Effect.Effect<string | undefined, WorkspaceError>;
  readonly setThreadSession: (input: {
    readonly threadId: ThreadId;
    readonly session: OrchestrationSession;
    readonly createdAt: string;
  }) => Effect.Effect<unknown, OrchestrationDispatchError>;
}

export interface EnsureProviderSessionOptions {
  readonly modelSelection?: ModelSelection;
  readonly providerOptions?: ProviderStartOptions;
  readonly runtimeMode?: RuntimeMode;
}

function mapProviderSessionStatus(
  status: ProviderSession["status"],
): OrchestrationSession["status"] {
  switch (status) {
    case "connecting":
      return "starting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "closed":
      return "stopped";
    case "ready":
    default:
      return "ready";
  }
}

/** Owns live provider reuse, restart, switch, fork, and projection rebinding decisions. */
export function makeProviderSessionCoordinator<ResolveError, WorkspaceError>(
  dependencies: ProviderSessionCoordinatorDependencies<ResolveError, WorkspaceError>,
) {
  const { providerService, state } = dependencies;

  const ensureSessionForThread = Effect.fnUntraced(function* (
    threadId: ThreadId,
    createdAt: string,
    options?: EnsureProviderSessionOptions,
  ) {
    const thread = yield* dependencies.resolveThread(threadId);
    if (!thread) {
      return yield* Effect.die(
        new Error(`Thread '${threadId}' was not found in projection state.`),
      );
    }
    const shouldRegisterContextBootstrap =
      thread.session?.status !== "stopped" && !state.bootstrapState.isNextStartSuppressed(threadId);

    const resolveActiveSession = (targetThreadId: ThreadId) =>
      providerService
        .listSessions()
        .pipe(
          Effect.map((sessions) => sessions.find((session) => session.threadId === targetThreadId)),
        );

    const activeSession = yield* resolveActiveSession(threadId);
    const desiredRuntimeMode = options?.runtimeMode ?? thread.runtimeMode;
    const projectedProvider: ProviderKind | undefined = Schema.is(ProviderKind)(
      thread.session?.providerName,
    )
      ? thread.session.providerName
      : undefined;
    const currentProvider: ProviderKind | undefined = activeSession?.provider ?? projectedProvider;
    const requestedModelSelection = options?.modelSelection;
    const desiredModelSelection = requestedModelSelection ?? thread.modelSelection;
    const desiredProvider = desiredModelSelection.provider;
    const effectiveCwd = yield* dependencies.resolveProjectedThreadWorkspaceCwd(thread);

    const startProviderSession = (input?: {
      readonly resumeCursor?: unknown;
      readonly provider?: ProviderKind;
    }): Effect.Effect<ProviderSession, ProviderServiceError> =>
      providerService.startSession(threadId, {
        threadId,
        provider: input?.provider ?? desiredProvider,
        ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
        modelSelection: desiredModelSelection,
        ...(options?.providerOptions !== undefined
          ? { providerOptions: options.providerOptions }
          : {}),
        ...(input?.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
        runtimeMode: desiredRuntimeMode,
      });

    const bindSessionToThread = (session: ProviderSession) =>
      dependencies.setThreadSession({
        threadId,
        session: {
          threadId,
          status: mapProviderSessionStatus(session.status),
          providerName: session.provider,
          runtimeMode: desiredRuntimeMode,
          activeTurnId: null,
          lastError: session.lastError ?? null,
          updatedAt: session.updatedAt,
        },
        createdAt,
      });

    const existingSessionThreadId = activeSession ? thread.id : null;
    if (existingSessionThreadId && activeSession) {
      const runtimeModeChanged = desiredRuntimeMode !== thread.session?.runtimeMode;
      const providerChanged = activeSession.provider !== desiredProvider;
      const sessionModelSwitch =
        currentProvider === undefined
          ? "in-session"
          : (yield* providerService.getCapabilities(currentProvider)).sessionModelSwitch;
      const modelChanged =
        requestedModelSelection !== undefined &&
        requestedModelSelection.model !== activeSession.model;
      const shouldRestartForModelChange = modelChanged && sessionModelSwitch === "restart-session";
      const previousModelSelection = state.selectionState.getModelSelection(threadId);
      const shouldRestartForModelSelectionChange =
        requestedModelSelection !== undefined &&
        (currentProvider === "claudeAgent"
          ? claudeSelectionRequiresRestart(
              previousModelSelection ?? thread.modelSelection,
              requestedModelSelection,
            )
          : (currentProvider === "droid" || currentProvider === "grok") &&
            !Equal.equals(previousModelSelection, requestedModelSelection));

      if (
        !runtimeModeChanged &&
        !providerChanged &&
        !shouldRestartForModelChange &&
        !shouldRestartForModelSelectionChange
      ) {
        return existingSessionThreadId;
      }

      const resumeCursor =
        providerChanged || shouldRestartForModelChange || runtimeModeChanged
          ? undefined
          : activeSession.resumeCursor;
      yield* Effect.logInfo("provider command reactor restarting provider session", {
        threadId,
        existingSessionThreadId,
        currentProvider,
        desiredProvider,
        currentRuntimeMode: thread.session?.runtimeMode,
        desiredRuntimeMode,
        runtimeModeChanged,
        providerChanged,
        modelChanged,
        shouldRestartForModelChange,
        shouldRestartForModelSelectionChange,
        hasResumeCursor: resumeCursor !== undefined,
      });
      if (providerChanged) {
        yield* providerService.stopSession({ threadId });
        state.selectionState.clear(threadId);
        state.bootstrapState.clearContext(threadId);
        if (shouldRegisterContextBootstrap) {
          state.bootstrapState.registerFreshSession(threadId);
        }
      }
      const restartedSession = yield* startProviderSession(
        providerChanged
          ? { provider: desiredProvider }
          : resumeCursor !== undefined
            ? { resumeCursor }
            : undefined,
      );
      if (
        shouldRegisterContextBootstrap &&
        currentProvider === "droid" &&
        !providerChanged &&
        resumeCursor === undefined
      ) {
        state.bootstrapState.registerFreshSession(threadId);
      }
      state.selectionState.setModelSelection(threadId, desiredModelSelection);
      yield* Effect.logInfo("provider command reactor restarted provider session", {
        threadId,
        previousSessionId: existingSessionThreadId,
        restartedSessionThreadId: restartedSession.threadId,
        provider: restartedSession.provider,
        runtimeMode: restartedSession.runtimeMode,
      });
      yield* bindSessionToThread(restartedSession);
      state.bootstrapState.clearNextStartSuppression(threadId);
      return restartedSession.threadId;
    }

    if (providerService.forkThread && thread.forkSourceThreadId) {
      const forked = yield* providerService.forkThread({
        sourceThreadId: thread.forkSourceThreadId,
        threadId,
        ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
        modelSelection: desiredModelSelection,
        ...(options?.providerOptions !== undefined
          ? { providerOptions: options.providerOptions }
          : {}),
        runtimeMode: desiredRuntimeMode,
      });
      if (forked) {
        if (
          shouldRegisterContextBootstrap &&
          desiredProvider === "droid" &&
          thread.sidechatSourceThreadId
        ) {
          state.bootstrapState.registerSidechat(threadId);
        }
        state.selectionState.setModelSelection(threadId, desiredModelSelection);
        const forkedSession =
          (yield* resolveActiveSession(threadId)) ??
          ({
            provider: desiredProvider,
            status: "ready",
            runtimeMode: desiredRuntimeMode,
            ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
            model: desiredModelSelection.model,
            threadId,
            ...(forked.resumeCursor !== undefined ? { resumeCursor: forked.resumeCursor } : {}),
            createdAt,
            updatedAt: createdAt,
          } satisfies ProviderSession);
        yield* bindSessionToThread(forkedSession);
        state.bootstrapState.clearNextStartSuppression(threadId);
        return threadId;
      }
      if (shouldRegisterContextBootstrap && !thread.sidechatSourceThreadId) {
        state.bootstrapState.registerFreshSession(threadId);
      }
    }

    if (
      shouldRegisterContextBootstrap &&
      thread.sidechatSourceThreadId &&
      thread.forkSourceThreadId
    ) {
      state.bootstrapState.registerSidechat(threadId);
    }

    const startedSession = yield* startProviderSession();
    state.selectionState.setModelSelection(threadId, desiredModelSelection);
    yield* bindSessionToThread(startedSession);
    state.bootstrapState.clearNextStartSuppression(threadId);
    return startedSession.threadId;
  });

  return { ensureSessionForThread } as const;
}
