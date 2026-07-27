import { randomUUID } from "node:crypto";

import type { ServerSettings, ThreadId } from "@agent-group/contracts";
import { Effect, Layer, Result, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ServerConfig } from "../../config";
import { FirstTurnThreadTitle } from "../../orchestration/Services/FirstTurnThreadTitle";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine";
import { ExecutionAdapterAuthority } from "../../orchestration/Services/ExecutionAdapterAuthority";
import { ExecutionAdapterCoordinator } from "../../orchestration/Services/ExecutionAdapterCoordinator";
import { ProviderRuntimeIngestionService } from "../../orchestration/Services/ProviderRuntimeIngestion";
import { ProviderService } from "../../provider/Services/ProviderService";
import { ServerSettingsService } from "../../serverSettings";
import { TerminalAgentBridge } from "../Services/TerminalAgentBridge";
import {
  TerminalAgentService,
  type TerminalAgentServiceShape,
} from "../Services/TerminalAgentService";
import {
  launchTerminalRuntime,
  probeTerminalRuntime,
  type TerminalRuntimeLaunchDependencies,
} from "../terminalAgentRuntimeLaunch";
import { makeTerminalAgentCurrentAdapterStop } from "../terminalAgentCurrentAdapterStop";
import { resolveTerminalTarget } from "../terminalAgentRuntimeResolution";
import type { RuntimeEventDependencies } from "../terminalAgentRuntimeEvents";
import { monitorTerminalAgentExits } from "../terminalAgentExitMonitor";
import { terminalTurnIsInFlight } from "../terminalAgentLifecycleGuards";
import { runTerminalAgentLaunchTransaction } from "../terminalAgentLaunchTransaction";
import { makeTerminalAgentOperationLocks } from "../terminalAgentOperationLocks";
import { makeTerminalAgentPersistedRecovery } from "../terminalAgentPersistedRecovery";
import { readPersistedProviderResumeCursor } from "../terminalAgentPersistedContinuity";
import { makeTerminalProviderCursorAdopter } from "../terminalAgentProviderCursorAdoption";
import {
  activeTerminalRecoveryThreadIds,
  recoverStructuredAuthority,
  recoverTerminalRuntime,
} from "../terminalAgentRecovery";
import { recoverTerminalAgentAuthorities } from "../terminalAgentRecoveryCoordinator";
import { makeTerminalRecoveryFailureHandler } from "../terminalAgentRecoveryFailure";
import { makeTerminalRuntimeRetirer } from "../terminalAgentRuntimeCleanup";
import { pauseTerminalRuntime } from "../terminalAgentRuntimeQuiesce";
import {
  requireManagedTerminalEnabled as requireEnabled,
  terminalAgentCauseMessage as causeMessage,
  terminalAgentServiceError as serviceError,
} from "../terminalAgentServiceErrors";
import { abortTerminalTurnForTeardown } from "../terminalAgentTeardown";
import type {
  ResolvedTerminalTarget,
  TerminalAgentRuntimeRecord,
} from "../terminalAgentRuntimeTypes";
import {
  makeTerminalAgentStateProjector,
  visibleTranscriptBootstrap,
} from "../terminalAgentRuntimeState";
import { makeTerminalAgentSubscription } from "../terminalAgentSubscription";

const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const settingsService = yield* ServerSettingsService;
  const authorityService = yield* ExecutionAdapterAuthority;
  const coordinator = yield* ExecutionAdapterCoordinator;
  const engine = yield* OrchestrationEngineService;
  const ingestion = yield* ProviderRuntimeIngestionService;
  const providerService = yield* ProviderService;
  const bridge = yield* TerminalAgentBridge;
  const firstTurnThreadTitle = yield* FirstTurnThreadTitle;
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const records = new Map<ThreadId, TerminalAgentRuntimeRecord>();
  const persistedRecovery = makeTerminalAgentPersistedRecovery({
    stateDir: config.stateDir,
    records,
  });
  const operationLocks = yield* makeTerminalAgentOperationLocks;
  const getSettings = () => Effect.runPromise(settingsService.getSettings);
  const adoptProviderResumeCursor = makeTerminalProviderCursorAdopter(
    providerService,
    coordinator,
    config.stateDir,
  );
  const onRecoveryFailure = makeTerminalRecoveryFailureHandler(coordinator);
  const launchDependencies: TerminalRuntimeLaunchDependencies = {
    stateDir: config.stateDir,
    homeDir: config.homeDir,
    bridge,
    coordinator,
    engine,
    ingestion,
    childProcessSpawner,
    getSettings,
    maybeGenerateAndRenameThreadTitleForFirstTurn: (input) =>
      Effect.runPromise(firstTurnThreadTitle.maybeGenerateAndRename(input)),
    listProviderSessions: () => Effect.runPromise(providerService.listSessions()),
    readPersistedProviderResumeCursor: (threadId, provider) =>
      readPersistedProviderResumeCursor(providerService, threadId, provider),
    revalidateLaunchContext: async (threadId) => {
      const settings = await getSettings();
      const target = await Effect.runPromise(resolveTerminalTarget({ engine, settings, threadId }));
      return { target, settings };
    },
    adoptProviderResumeCursor,
    records,
  };

  const runtimeEventDependencies = (
    runtime: TerminalAgentRuntimeRecord,
  ): RuntimeEventDependencies => ({
    runtime,
    getSettings,
    coordinator,
    engine,
    ingestion,
    maybeGenerateAndRenameThreadTitleForFirstTurn: (input) =>
      Effect.runPromise(firstTurnThreadTitle.maybeGenerateAndRename(input)),
    adoptProviderResumeCursor: (cursor, providerSessionId) =>
      adoptProviderResumeCursor(runtime, cursor, providerSessionId),
  });

  const resolveTarget = (threadId: ThreadId, settings: ServerSettings, allowDisabled = false) =>
    resolveTerminalTarget({
      engine,
      settings,
      threadId,
      ...(allowDisabled ? { allowDisabled: true } : {}),
    });

  const toState = makeTerminalAgentStateProjector(records);

  const get: TerminalAgentServiceShape["get"] = (threadId) =>
    Effect.gen(function* () {
      const settings = yield* settingsService.getSettings.pipe(
        Effect.mapError((cause) =>
          serviceError("invalid-state", "Server settings are unavailable.", cause),
        ),
      );
      const target = yield* resolveTarget(threadId, settings, true);
      return toState(target, yield* coordinator.getState(threadId));
    });

  const abortForTeardown = (runtime: TerminalAgentRuntimeRecord, reason: string) =>
    abortTerminalTurnForTeardown({
      runtime,
      reason,
      coordinator,
      eventDependencies: runtimeEventDependencies(runtime),
    });
  const retireRuntime = makeTerminalRuntimeRetirer(config.stateDir);

  const launch = (input: {
    readonly target: ResolvedTerminalTarget;
    readonly settings: ServerSettings;
    readonly operation: "start" | "restart";
    readonly providerSessionId: string | null;
    readonly resume: boolean;
    readonly transcriptBootstrap: string | null;
    readonly cols: number;
    readonly rows: number;
  }) =>
    Effect.gen(function* () {
      const capabilities = yield* Effect.tryPromise({
        try: () =>
          probeTerminalRuntime({
            target: input.target,
            settings: input.settings,
            childProcessSpawner,
          }),
        catch: (cause) =>
          serviceError(
            "probe-failed",
            `Agent Terminal capability probe failed: ${causeMessage(cause)}`,
            cause,
          ),
      });
      yield* runTerminalAgentLaunchTransaction(
        () =>
          launchTerminalRuntime({
            dependencies: launchDependencies,
            target: input.target,
            settings: input.settings,
            capabilities,
            runtimeInstanceId: randomUUID(),
            providerSessionId: input.providerSessionId,
            resume: input.resume,
            operation: input.operation,
            transcriptBootstrap: input.transcriptBootstrap,
            cols: input.cols,
            rows: input.rows,
          }),
        (cause) =>
          serviceError(
            "launch-failed",
            `Agent Terminal failed to launch: ${causeMessage(cause)}`,
            cause,
          ),
      );
      return toState(input.target, yield* coordinator.getState(input.target.threadId));
    });

  const start: TerminalAgentServiceShape["start"] = (request) =>
    operationLocks.withThread(
      request.threadId,
      Effect.gen(function* () {
        const settings = yield* settingsService.getSettings.pipe(
          Effect.mapError((cause) =>
            serviceError("invalid-state", "Server settings are unavailable.", cause),
          ),
        );
        yield* requireEnabled(settings);
        const target = yield* resolveTarget(request.threadId, settings);
        const authority = yield* coordinator.getState(request.threadId);
        if (authority.adapter !== "structured") {
          return yield* Effect.fail(
            serviceError("invalid-state", "This Thread already uses Agent Terminal."),
          );
        }
        const readModel = yield* engine.getReadModel();
        const thread = readModel.threads.find((entry) => entry.id === request.threadId);
        return yield* launch({
          target,
          settings,
          operation: "start",
          providerSessionId: target.provider === "codex" ? null : randomUUID(),
          resume: false,
          transcriptBootstrap: thread ? visibleTranscriptBootstrap(thread.messages) : null,
          cols: request.cols,
          rows: request.rows,
        });
      }),
    );

  const restart: TerminalAgentServiceShape["restart"] = (request) =>
    operationLocks.withThread(
      request.threadId,
      Effect.gen(function* () {
        const settings = yield* settingsService.getSettings.pipe(
          Effect.mapError((cause) =>
            serviceError("invalid-state", "Server settings are unavailable.", cause),
          ),
        );
        yield* requireEnabled(settings);
        const target = yield* resolveTarget(request.threadId, settings);
        const authority = yield* coordinator.getState(request.threadId);
        if (authority.adapter !== "terminal") {
          return yield* Effect.fail(
            serviceError("invalid-state", "This Thread is not using Agent Terminal."),
          );
        }
        const previous = records.get(request.threadId);
        yield* persistedRecovery.ensureDetachedOwnerExited(authority, previous);
        if (terminalTurnIsInFlight(authority, previous)) {
          return yield* Effect.fail(
            serviceError(
              "invalid-state",
              "Finish or interrupt the active Agent Turn before restarting Terminal.",
            ),
          );
        }
        if (previous) {
          yield* pauseTerminalRuntime(previous);
          yield* abortForTeardown(previous, "Agent Terminal restarted.");
        }
        const readModel = yield* engine.getReadModel();
        const thread = readModel.threads.find((entry) => entry.id === request.threadId);
        const providerSessionId =
          authority.providerSessionId ?? (target.provider === "codex" ? null : randomUUID());
        const attempted = yield* Effect.result(
          launch({
            target,
            settings,
            operation: "restart",
            providerSessionId,
            resume: authority.providerSessionId !== null,
            transcriptBootstrap:
              authority.providerSessionId === null && thread
                ? visibleTranscriptBootstrap(thread.messages)
                : null,
            cols: request.cols,
            rows: request.rows,
          }),
        );
        if (Result.isSuccess(attempted)) {
          yield* persistedRecovery.retirePreviousRuntime(request.threadId, authority);
          return attempted.success;
        }
        if (previous) {
          const current = yield* coordinator.getState(request.threadId);
          if (
            current.adapter === "terminal" &&
            current.revision === previous.revision &&
            current.runtimeInstanceId === previous.runtimeInstanceId &&
            current.generation === previous.generation &&
            (yield* coordinator.isTerminalHostAlive(request.threadId))
          ) {
            previous.resumeHook();
          } else {
            previous.unregisterHook();
          }
        }
        return yield* Effect.fail(attempted.failure);
      }),
    );

  const switchToChat: TerminalAgentServiceShape["switchToChat"] = (threadId) =>
    operationLocks.withThread(
      threadId,
      Effect.gen(function* () {
        const runtime = records.get(threadId);
        const authority = yield* coordinator.getState(threadId);
        yield* persistedRecovery.ensureDetachedOwnerExited(authority, runtime);
        if (terminalTurnIsInFlight(authority, runtime)) {
          return yield* Effect.fail(
            serviceError(
              "invalid-state",
              "Finish or interrupt the active Agent Turn before switching to Chat.",
            ),
          );
        }
        if (runtime) {
          yield* pauseTerminalRuntime(runtime);
          yield* abortForTeardown(runtime, "Switched to structured Chat.");
        }
        const switched = yield* Effect.result(
          coordinator
            .switchToStructured(threadId)
            .pipe(
              Effect.mapError((cause) =>
                serviceError("adapter", `Failed to switch to Chat: ${cause.message}`, cause),
              ),
            ),
        );
        if (Result.isFailure(switched)) {
          runtime?.resumeHook();
          return yield* Effect.fail(switched.failure);
        }
        runtime?.unregisterHook();
        if (runtime) yield* retireRuntime(runtime);
        records.delete(threadId);
        return yield* get(threadId);
      }),
    );

  const stopCurrentAdapterImpl = makeTerminalAgentCurrentAdapterStop({
    coordinator,
    records,
    ensureDetachedOwnerExited: (threadId, runtime) =>
      coordinator
        .getState(threadId)
        .pipe(
          Effect.flatMap((state) => persistedRecovery.ensureDetachedOwnerExited(state, runtime)),
        ),
    abortForTeardown,
    retireRuntime,
  });
  const stopCurrentAdapter: TerminalAgentServiceShape["stopCurrentAdapter"] = (
    threadId,
    stopStructured,
  ) => operationLocks.withThread(threadId, stopCurrentAdapterImpl(threadId, stopStructured));

  const write: TerminalAgentServiceShape["write"] = (request) =>
    coordinator
      .write(request)
      .pipe(
        Effect.mapError((cause) =>
          serviceError("stale-runtime", `Terminal input was rejected: ${cause.message}`, cause),
        ),
      );
  const resize: TerminalAgentServiceShape["resize"] = (request) =>
    coordinator
      .resize(request)
      .pipe(
        Effect.mapError((cause) =>
          serviceError("stale-runtime", `Terminal resize was rejected: ${cause.message}`, cause),
        ),
      );

  const subscribe: TerminalAgentServiceShape["subscribe"] = (threadId, mode = "terminal") =>
    Stream.unwrap(
      settingsService.getSettings.pipe(
        Effect.mapError((cause) =>
          serviceError("invalid-state", "Server settings are unavailable.", cause),
        ),
        Effect.flatMap((settings) => resolveTarget(threadId, settings, true)),
        Effect.map((target) =>
          makeTerminalAgentSubscription({
            threadId,
            provider: target.provider,
            coordinator,
            runtimeForThread: () => records.get(threadId),
            includeOutput: mode === "terminal",
          }),
        ),
      ),
    );

  const teardownThread: TerminalAgentServiceShape["teardownThread"] = (threadId) =>
    operationLocks.withThread(
      threadId,
      Effect.gen(function* () {
        const runtime = records.get(threadId);
        if (!runtime) {
          yield* persistedRecovery.ensureDetachedOwnerExited(
            yield* coordinator.getState(threadId),
            runtime,
          );
        }
        if (runtime) {
          yield* pauseTerminalRuntime(runtime);
          yield* abortForTeardown(runtime, "Thread deleted.");
        }
        const tornDown = yield* Effect.result(
          coordinator
            .teardownThread(threadId)
            .pipe(
              Effect.mapError((cause) =>
                serviceError(
                  "adapter",
                  `Failed to teardown Agent Terminal: ${cause.message}`,
                  cause,
                ),
              ),
            ),
        );
        if (Result.isFailure(tornDown)) {
          runtime?.resumeHook();
          return yield* Effect.fail(tornDown.failure);
        }
        runtime?.unregisterHook();
        if (runtime) yield* retireRuntime(runtime);
        records.delete(threadId);
      }),
    );

  const recover: TerminalAgentServiceShape["recover"] = Effect.gen(function* () {
    const activeThreads = activeTerminalRecoveryThreadIds(yield* engine.getReadModel());
    yield* recoverTerminalAgentAuthorities({
      getSettings: settingsService.getSettings,
      listStates: authorityService.listStates,
      withThread: operationLocks.withThread,
      recoverTerminal: (threadId, state, settings) =>
        recoverTerminalRuntime({
          threadId,
          state,
          settings,
          coordinator,
          ingestion,
          engine,
          resolveTarget,
          launch,
          ensurePreviousOwnerExited: persistedRecovery.ensureOwnerExited,
          retirePreviousRuntime: () => persistedRecovery.retirePreviousRuntime(threadId, state),
        }),
      recoverStructured: (threadId, state) =>
        recoverStructuredAuthority({
          threadId,
          state,
          authority: authorityService,
          threadActive: activeThreads.has(threadId),
        }),
      onRecoveryFailure,
    });
  });
  yield* Effect.forkScoped(
    monitorTerminalAgentExits({
      coordinator,
      records,
      eventDependencies: runtimeEventDependencies,
      retireRuntime,
      serialize: (threadId, operation) => operationLocks.withThread(threadId, operation),
    }),
  );
  return {
    get,
    start,
    restart,
    switchToChat,
    stopCurrentAdapter,
    write,
    resize,
    subscribe,
    teardownThread,
    recover,
  } satisfies TerminalAgentServiceShape;
});
export const TerminalAgentServiceLive = Layer.effect(TerminalAgentService, make);
