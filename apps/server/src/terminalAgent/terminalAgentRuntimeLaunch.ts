import type {
  ProviderSession,
  ServerSettings,
  TerminalAgentCapabilitySnapshot,
  TerminalAgentProvider,
  ThreadId,
} from "@agent-group/contracts";
import { Effect, Result } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";

import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine";
import type {
  ExecutionAdapterCoordinatorShape,
  ExecutionAdapterSwitchResult,
} from "../orchestration/Services/ExecutionAdapterCoordinator";
import type { ProviderRuntimeIngestionShape } from "../orchestration/Services/ProviderRuntimeIngestion";
import { withProjectRuntimeGate } from "../orchestration/projectRuntimeGate";
import type { TerminalAgentBridgeShape } from "./Services/TerminalAgentBridge";
import {
  prepareTerminalAgentLaunch,
  probeTerminalAgent,
  terminalAgentRuntimeDir,
} from "./terminalAgentDriverRegistry";
import { resolveAvailableTerminalLaunchContinuity } from "./terminalAgentLaunchContinuity";
import { assertTerminalLaunchContextUnchanged } from "./terminalAgentLaunchRevalidation";
import { cacheTerminalAgentProbe } from "./terminalAgentProbeCache";
import { gateTerminalAgentBridgeHandler } from "./terminalAgentBridgeActivation";
import { makeTerminalAgentBridgeHandler } from "./terminalAgentRuntimeEvents";
import { retireTerminalRuntimeDirectory } from "./terminalAgentRuntimeCleanup";
import type {
  ResolvedTerminalTarget,
  TerminalAgentRuntimeRecord,
} from "./terminalAgentRuntimeTypes";
import type { TerminalAgentProviderResumeCursor } from "./terminalAgentProtocol";

export interface TerminalRuntimeLaunchDependencies {
  readonly stateDir: string;
  readonly homeDir: string;
  readonly bridge: TerminalAgentBridgeShape;
  readonly coordinator: ExecutionAdapterCoordinatorShape;
  readonly engine: OrchestrationEngineShape;
  readonly ingestion: ProviderRuntimeIngestionShape;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly getSettings: () => Promise<ServerSettings>;
  readonly listProviderSessions: () => Promise<ReadonlyArray<ProviderSession>>;
  readonly readPersistedProviderResumeCursor: (
    threadId: ThreadId,
    provider: TerminalAgentProvider,
  ) => Promise<unknown>;
  readonly revalidateLaunchContext: (threadId: ThreadId) => Promise<{
    readonly target: ResolvedTerminalTarget;
    readonly settings: ServerSettings;
  }>;
  readonly adoptProviderResumeCursor: (
    runtime: TerminalAgentRuntimeRecord,
    cursor: TerminalAgentProviderResumeCursor,
    providerSessionId: string,
  ) => Promise<void>;
  readonly records: Map<ThreadId, TerminalAgentRuntimeRecord>;
}

function modelMetadata(target: ResolvedTerminalTarget) {
  const selection = target.modelSelection;
  switch (selection.provider) {
    case "codex":
      return {
        model: selection.model,
        effort: selection.options?.reasoningEffort ?? null,
      };
    case "claudeAgent":
      return {
        model: selection.model,
        effort: selection.options?.effort ?? null,
      };
    case "pi":
      return {
        model: selection.model,
        effort: selection.options?.thinkingLevel ?? null,
      };
  }
}

export async function probeTerminalRuntime(input: {
  readonly target: ResolvedTerminalTarget;
  readonly settings: ServerSettings;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
}): Promise<TerminalAgentCapabilitySnapshot> {
  return cacheTerminalAgentProbe(input.target, input.settings, input.childProcessSpawner, () =>
    Effect.runPromise(
      probeTerminalAgent({
        provider: input.target.provider,
        modelSelection: input.target.modelSelection,
        settings: input.settings,
        childProcessSpawner: input.childProcessSpawner,
      }),
    ),
  );
}

async function launchTerminalRuntimeUnlocked(input: {
  readonly dependencies: TerminalRuntimeLaunchDependencies;
  readonly target: ResolvedTerminalTarget;
  readonly settings: ServerSettings;
  readonly capabilities: TerminalAgentCapabilitySnapshot;
  readonly runtimeInstanceId: string;
  readonly providerSessionId: string | null;
  readonly resume: boolean;
  readonly operation: "start" | "restart";
  readonly transcriptBootstrap: string | null;
  readonly cols: number;
  readonly rows: number;
}): Promise<{
  readonly runtime: TerminalAgentRuntimeRecord;
  readonly result: ExecutionAdapterSwitchResult;
}> {
  const previousRuntime = input.dependencies.records.get(input.target.threadId);
  const runtimeDir = terminalAgentRuntimeDir({
    stateDir: input.dependencies.stateDir,
    threadId: input.target.threadId,
    runtimeInstanceId: input.runtimeInstanceId,
    provider: input.target.provider,
  });
  const metadata = modelMetadata(input.target);
  const runtime: TerminalAgentRuntimeRecord = {
    ...input.target,
    runtimeInstanceId: input.runtimeInstanceId,
    runtimeDir,
    revision: 0,
    generation: "",
    providerSessionId: input.providerSessionId,
    capabilities: input.capabilities,
    model: metadata.model,
    effort: metadata.effort,
    permission: null,
    context: null,
    activeTurn: null,
    transcriptBootstrap: input.transcriptBootstrap,
    handshakeReceived: false,
    metadataStatePublicationPending: false,
    pauseHook: async () => {},
    resumeHook: () => {},
    unregisterHook: () => {},
    eventResponses: new Map(),
  };
  let activate: (ready: boolean) => void = () => {};
  const activation = new Promise<boolean>((resolve) => {
    activate = resolve;
  });
  const handler = makeTerminalAgentBridgeHandler({
    runtime,
    getSettings: input.dependencies.getSettings,
    coordinator: input.dependencies.coordinator,
    engine: input.dependencies.engine,
    ingestion: input.dependencies.ingestion,
    adoptProviderResumeCursor: (cursor, providerSessionId) =>
      input.dependencies.adoptProviderResumeCursor(runtime, cursor, providerSessionId),
  });
  const registration = await Effect.runPromise(
    input.dependencies.bridge.register(
      input.runtimeInstanceId,
      gateTerminalAgentBridgeHandler(activation, handler),
    ),
  );
  runtime.pauseHook = registration.pause;
  runtime.resumeHook = registration.resume;
  runtime.unregisterHook = registration.unregister;
  const retireReplacedRuntimeDirectory = async () => {
    if (previousRuntime === undefined || previousRuntime.runtimeDir === runtime.runtimeDir) {
      return;
    }
    await retireTerminalRuntimeDirectory(
      input.dependencies.stateDir,
      previousRuntime.runtimeDir,
    ).catch((cleanupCause) => {
      Effect.runFork(
        Effect.logWarning("retired Agent Terminal runtime could not be removed", {
          runtimeDir: previousRuntime.runtimeDir,
          cause: cleanupCause,
        }),
      );
    });
  };
  let switched: ExecutionAdapterSwitchResult | null = null;
  try {
    const prepare = async (sessions: ReadonlyArray<ProviderSession>) => {
      const current = await input.dependencies.revalidateLaunchContext(input.target.threadId);
      assertTerminalLaunchContextUnchanged({
        expectedTarget: input.target,
        expectedSettings: input.settings,
        currentTarget: current.target,
        currentSettings: current.settings,
      });
      const continuity = await resolveAvailableTerminalLaunchContinuity({
        sessions,
        threadId: input.target.threadId,
        provider: input.target.provider,
        operation: input.operation,
        providerSessionId: input.providerSessionId,
        resume: input.resume,
        persistedResumeCursor: await input.dependencies.readPersistedProviderResumeCursor(
          input.target.threadId,
          input.target.provider,
        ),
        homeDir: input.dependencies.homeDir,
        codexHomePath: input.settings.providers.codex.homePath,
      });
      const launch = await prepareTerminalAgentLaunch({
        stateDir: input.dependencies.stateDir,
        threadId: input.target.threadId,
        workspaceRoot: input.target.workspaceRoot,
        runtimeInstanceId: input.runtimeInstanceId,
        provider: input.target.provider,
        ...continuity,
        hookEndpoint: input.dependencies.bridge.endpoint,
        hookToken: registration.token,
        modelSelection: input.target.modelSelection,
        runtimeMode: input.target.runtimeMode,
        settings: input.settings,
      });
      runtime.providerSessionId = continuity.providerSessionId;
      runtime.transcriptBootstrap = continuity.resume ? null : input.transcriptBootstrap;
      return {
        providerSessionId: continuity.providerSessionId,
        spawn: {
          command: launch.executable,
          args: launch.args,
          cwd: input.target.workspaceRoot,
          env: launch.env,
          cols: input.cols,
          rows: input.rows,
        },
      };
    };
    input.dependencies.records.set(input.target.threadId, runtime);
    const result = await Effect.runPromise(
      input.operation === "start"
        ? input.dependencies.coordinator.switchToTerminal({
            threadId: input.target.threadId,
            provider: input.target.provider,
            runtimeInstanceId: input.runtimeInstanceId,
            prepare: (session) =>
              Effect.tryPromise({
                try: () => prepare(session ? [session] : []),
                catch: (cause) => cause,
              }),
          })
        : Effect.tryPromise({
            try: async () =>
              input.dependencies.coordinator.restartTerminal({
                threadId: input.target.threadId,
                provider: input.target.provider,
                runtimeInstanceId: input.runtimeInstanceId,
                ...(await prepare(await input.dependencies.listProviderSessions())),
              }),
            catch: (cause) => cause,
          }).pipe(Effect.flatten),
    );
    switched = result;
    runtime.revision = result.revision;
    runtime.generation = result.generation;
    await Effect.runPromise(
      input.dependencies.coordinator.updateTerminalState({
        threadId: input.target.threadId,
        revision: result.revision,
        generation: result.generation,
        patch: { status: "checking", error: null },
      }),
    );
    activate(true);
    if (previousRuntime && previousRuntime !== runtime) {
      previousRuntime.unregisterHook();
      await retireReplacedRuntimeDirectory();
    }
    return { runtime, result };
  } catch (cause) {
    let launchAbortCompleted = false;
    if (switched) {
      const cleanup = await Effect.runPromise(
        Effect.result(
          input.dependencies.coordinator.abortTerminalLaunch({
            threadId: input.target.threadId,
            revision: switched.revision,
            generation: switched.generation,
            restoreStructured: input.operation === "start",
          }),
        ),
      );
      launchAbortCompleted = Result.isSuccess(cleanup);
      if (Result.isFailure(cleanup) && cleanup.failure.reason === "host") {
        // The authority/host inspection below retains the new bridge when
        // physical teardown could not be verified.
      }
    }
    let authority = await Effect.runPromise(
      input.dependencies.coordinator.getState(input.target.threadId),
    );
    const failedRuntimeOwnsAuthority =
      authority.adapter === "terminal" && authority.runtimeInstanceId === input.runtimeInstanceId;
    if (failedRuntimeOwnsAuthority) {
      await Effect.runPromise(
        input.dependencies.coordinator
          .updateTerminalState({
            threadId: input.target.threadId,
            revision: authority.revision,
            ...(authority.generation !== null ? { generation: authority.generation } : {}),
            patch: {
              status: "error",
              error: `Agent Terminal launch failed: ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
            },
          })
          .pipe(Effect.catch(() => Effect.void)),
      );
      authority = await Effect.runPromise(
        input.dependencies.coordinator.getState(input.target.threadId),
      );
      runtime.revision = authority.revision;
      if (authority.adapter === "terminal" && authority.generation !== null) {
        runtime.generation = authority.generation;
      }
      input.dependencies.records.set(input.target.threadId, runtime);
      activate(
        !launchAbortCompleted && authority.adapter === "terminal" && authority.generation !== null,
      );
      previousRuntime?.unregisterHook();
      await retireReplacedRuntimeDirectory();
      throw cause;
    }
    activate(false);
    registration.unregister();
    const previousStillOwnsAuthority =
      previousRuntime !== undefined &&
      authority.adapter === "terminal" &&
      authority.revision === previousRuntime.revision &&
      authority.runtimeInstanceId === previousRuntime.runtimeInstanceId &&
      authority.generation === previousRuntime.generation &&
      (await Effect.runPromise(
        input.dependencies.coordinator.isTerminalHostAlive(input.target.threadId),
      ));
    if (previousStillOwnsAuthority) {
      input.dependencies.records.set(input.target.threadId, previousRuntime);
      if (runtime.runtimeDir !== previousRuntime.runtimeDir) {
        await retireTerminalRuntimeDirectory(input.dependencies.stateDir, runtime.runtimeDir).catch(
          (cleanupCause) => {
            throw new AggregateError(
              [cause, cleanupCause],
              "Agent Terminal launch and runtime cleanup failed.",
            );
          },
        );
      }
    } else {
      previousRuntime?.unregisterHook();
      if (input.dependencies.records.get(input.target.threadId) === runtime) {
        input.dependencies.records.delete(input.target.threadId);
      }
      await retireTerminalRuntimeDirectory(input.dependencies.stateDir, runtime.runtimeDir).catch(
        (cleanupCause) => {
          throw new AggregateError(
            [cause, cleanupCause],
            "Agent Terminal launch and runtime cleanup failed.",
          );
        },
      );
    }
    throw cause;
  }
}

export const launchTerminalRuntime = (input: Parameters<typeof launchTerminalRuntimeUnlocked>[0]) =>
  Effect.runPromise(
    withProjectRuntimeGate(
      input.target.coordinates.groupId,
      Effect.tryPromise({
        try: () => launchTerminalRuntimeUnlocked(input),
        catch: (cause) => cause,
      }),
    ),
  );
