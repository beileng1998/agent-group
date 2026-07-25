import { randomUUID } from "node:crypto";

import {
  EventId,
  type OrchestrationReadModel,
  type ServerSettings,
  TerminalAgentProvider,
  type ThreadId,
  TurnId,
} from "@agent-group/contracts";
import { Effect, Result, Schema } from "effect";

import { finalizeAgentGroupTurn } from "../agentGroup/runtime";
import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine";
import type {
  ExecutionAdapterAuthorityShape,
  StructuredAuthorityState,
  TerminalAuthorityState,
} from "../orchestration/Services/ExecutionAdapterAuthority";
import type { ExecutionAdapterCoordinatorShape } from "../orchestration/Services/ExecutionAdapterCoordinator";
import type { ProviderRuntimeIngestionShape } from "../orchestration/Services/ProviderRuntimeIngestion";
import type { TerminalAgentServiceError } from "./Services/TerminalAgentService";
import { managedTerminalPlatformSupported } from "./terminalAgentServiceErrors";
import type { ResolvedTerminalTarget } from "./terminalAgentRuntimeTypes";
import { visibleTranscriptBootstrap } from "./terminalAgentRuntimeState";

export function activeTerminalRecoveryThreadIds(
  readModel: OrchestrationReadModel,
): ReadonlySet<ThreadId> {
  const activeProjects = new Set(
    readModel.projects
      .filter((project) => project.deletedAt === null)
      .map((project) => project.id),
  );
  return new Set(
    readModel.threads
      .filter(
        (thread) =>
          thread.deletedAt === null && activeProjects.has(thread.projectId),
      )
      .map((thread) => thread.id),
  );
}

export function recoverStructuredAuthority(input: {
  readonly threadId: ThreadId;
  readonly state: StructuredAuthorityState;
  readonly authority: ExecutionAdapterAuthorityShape;
  readonly threadActive: boolean;
}) {
  return Effect.gen(function* () {
    if (input.state.status === "deleting") return;
    if (input.state.status === "stopping") {
      yield* input.authority
        .completeStructuredStop(input.threadId, input.state.revision)
        .pipe(Effect.asVoid);
      return;
    }
    if (!input.threadActive) {
      yield* input.authority.beginThreadDeletion(input.threadId).pipe(
        Effect.asVoid,
      );
      return;
    }
    if (input.state.status === "restoring") {
      yield* input.authority
        .completeStructuredRestore(input.threadId, input.state.revision)
        .pipe(Effect.asVoid);
    }
  });
}

export function recoverTerminalRuntime(input: {
  readonly threadId: ThreadId;
  readonly state: TerminalAuthorityState;
  readonly settings: ServerSettings;
  readonly coordinator: ExecutionAdapterCoordinatorShape;
  readonly ingestion: ProviderRuntimeIngestionShape;
  readonly engine: OrchestrationEngineShape;
  readonly resolveTarget: (
    threadId: ThreadId,
    settings: ServerSettings,
    allowDisabled: boolean,
  ) => Effect.Effect<ResolvedTerminalTarget, TerminalAgentServiceError>;
  readonly launch: (request: {
    readonly target: ResolvedTerminalTarget;
    readonly settings: ServerSettings;
    readonly operation: "restart";
    readonly providerSessionId: string | null;
    readonly resume: boolean;
    readonly transcriptBootstrap: string | null;
    readonly cols: number;
    readonly rows: number;
  }) => Effect.Effect<unknown, TerminalAgentServiceError>;
  readonly ensurePreviousOwnerExited: (
    owner: Pick<
      TerminalAuthorityState,
      "pid" | "ownerIdentity" | "processGroupIdentity"
    >,
  ) => Effect.Effect<void, TerminalAgentServiceError>;
  readonly retirePreviousRuntime: () => Effect.Effect<void>;
  readonly platform?: NodeJS.Platform;
}) {
  return Effect.gen(function* () {
    const persistedProviderEnabled =
      Schema.is(TerminalAgentProvider)(input.state.provider) &&
      input.settings.providers[input.state.provider].enabled;
    const managedTerminalEnabled =
      input.settings.enableManagedAgentTerminal &&
      persistedProviderEnabled &&
      managedTerminalPlatformSupported(input.platform);
    const ensurePreviousOwnerExited = Effect.gen(function* () {
      const checked = yield* Effect.result(
        input.ensurePreviousOwnerExited(input.state),
      );
      if (Result.isSuccess(checked)) return;
      const current = yield* input.coordinator.getState(input.threadId);
      if (current.adapter === "terminal") {
        yield* input.coordinator
          .updateTerminalState({
            threadId: input.threadId,
            revision: current.revision,
            ...(current.generation !== null
              ? { generation: current.generation }
              : {}),
            patch: {
              status: "error",
              activeTurnId: null,
              error: checked.failure.message,
            },
          })
          .pipe(Effect.catch(() => Effect.void));
      }
      return yield* Effect.fail(checked.failure);
    });
    if (input.state.status === "deleting") {
      yield* ensurePreviousOwnerExited;
      yield* input.retirePreviousRuntime();
      return;
    }
    const ensureStoppedOwnerExited =
      input.state.pid === null &&
      input.state.ownerIdentity === null &&
      input.state.processGroupIdentity === null
        ? Effect.void
        : ensurePreviousOwnerExited;
    const targetResult = yield* Effect.result(
      input.resolveTarget(input.threadId, input.settings, true),
    );
    const targetIsMissing =
      targetResult._tag === "Failure" &&
      targetResult.failure.reason === "thread-not-found";
    const targetMatchesPersistedProvider =
      targetResult._tag === "Success" &&
      Schema.is(TerminalAgentProvider)(input.state.provider) &&
      targetResult.success.provider === input.state.provider;
    if (input.state.status === "stopping") {
      yield* ensurePreviousOwnerExited;
      if (targetIsMissing) {
        yield* input.coordinator.teardownThread(input.threadId);
        yield* input.retirePreviousRuntime();
        return;
      }
      yield* input.coordinator.updateTerminalState({
        threadId: input.threadId,
        revision: input.state.revision,
        ...(input.state.generation !== null
          ? { generation: input.state.generation }
          : {}),
        patch: {
          status: "stopped",
          pid: null,
          ownerIdentity: null,
          processGroupIdentity: null,
          activeTurnId: null,
          error: "Agent Terminal stop was completed during server recovery.",
        },
      });
      if (!managedTerminalEnabled || !targetMatchesPersistedProvider) {
        yield* input.coordinator.switchToStructured(input.threadId);
      }
      yield* input.retirePreviousRuntime();
      return;
    }
    if (input.state.status === "stopped") {
      if (targetIsMissing) {
        yield* ensureStoppedOwnerExited;
        yield* input.coordinator.teardownThread(input.threadId);
        yield* input.retirePreviousRuntime();
        return;
      }
      if (!managedTerminalEnabled || !targetMatchesPersistedProvider) {
        yield* ensureStoppedOwnerExited;
        yield* input.coordinator.switchToStructured(input.threadId);
      }
      yield* input.retirePreviousRuntime();
      return;
    }
    let projectionFailed = false;
    if (input.state.activeTurnId !== null || input.state.status === "running") {
      if (
        input.state.activeTurnId !== null &&
        input.state.generation !== null
      ) {
        const projected = yield* Effect.result(
          input.ingestion.publishTerminal({
            type: "turn.aborted",
            eventId: EventId.makeUnsafe(
              `terminal-recover:${input.state.runtimeInstanceId}:${input.state.revision}`,
            ),
            provider: input.state.provider,
            threadId: input.threadId,
            turnId: TurnId.makeUnsafe(input.state.activeTurnId),
            createdAt: new Date().toISOString(),
            terminalRuntimeFence: {
              revision: input.state.revision,
              generation: input.state.generation,
            },
            payload: {
              reason: "Agent Terminal was interrupted by server restart.",
            },
          }),
        );
        projectionFailed = projected._tag === "Failure";
      } else if (input.state.activeTurnId !== null) {
        projectionFailed = true;
      }
      yield* input.coordinator.updateTerminalState({
        threadId: input.threadId,
        revision: input.state.revision,
        ...(input.state.generation !== null
          ? { generation: input.state.generation }
          : {}),
        patch: {
          status: "exited",
          activeTurnId: null,
          error: "Agent Terminal was interrupted by server restart.",
        },
      });
      if (targetResult._tag === "Success") {
        yield* Effect.promise(() =>
          finalizeAgentGroupTurn({
            ...targetResult.success.coordinates,
            turnId: null,
            successful: false,
          }).catch(() => null),
        );
      }
    } else if (
      input.state.status === "starting" ||
      input.state.status === "checking"
    ) {
      yield* input.coordinator.updateTerminalState({
        threadId: input.threadId,
        revision: input.state.revision,
        ...(input.state.generation !== null
          ? { generation: input.state.generation }
          : {}),
        patch: {
          status: "exited",
          activeTurnId: null,
          error: "Agent Terminal was interrupted by server restart.",
        },
      });
    }
    yield* ensurePreviousOwnerExited;
    if (targetIsMissing) {
      yield* input.coordinator.teardownThread(input.threadId);
      yield* input.retirePreviousRuntime();
      return;
    }
    if (projectionFailed || !managedTerminalEnabled) {
      yield* input.coordinator.switchToStructured(input.threadId);
      yield* input.retirePreviousRuntime();
      return;
    }
    if (targetResult._tag === "Failure") {
      yield* input.coordinator.switchToStructured(input.threadId);
      yield* input.retirePreviousRuntime();
      return yield* Effect.fail(targetResult.failure);
    }
    const target = targetResult.success;
    if (
      !Schema.is(TerminalAgentProvider)(input.state.provider) ||
      input.state.provider !== target.provider
    ) {
      yield* input.coordinator.switchToStructured(input.threadId);
      yield* input.retirePreviousRuntime();
      return;
    }
    const readModel = yield* input.engine.getReadModel();
    const thread = readModel.threads.find(
      (entry) => entry.id === input.threadId,
    );
    const restarted = yield* Effect.result(
      input.launch({
        target,
        settings: input.settings,
        operation: "restart",
        providerSessionId:
          input.state.providerSessionId ??
          (target.provider === "codex" ? null : randomUUID()),
        resume: input.state.providerSessionId !== null,
        transcriptBootstrap:
          input.state.providerSessionId === null && thread
            ? visibleTranscriptBootstrap(thread.messages)
            : null,
        cols: 80,
        rows: 24,
      }),
    );
    if (restarted._tag === "Success") {
      yield* input.retirePreviousRuntime();
      return;
    }
    const current = yield* input.coordinator.getState(input.threadId);
    if (current.adapter === "terminal") {
      yield* input.coordinator
        .updateTerminalState({
          threadId: input.threadId,
          revision: current.revision,
          ...(current.generation !== null
            ? { generation: current.generation }
            : {}),
          patch: {
            status: "error",
            activeTurnId: null,
            error: `Agent Terminal recovery failed: ${
              restarted.failure instanceof Error
                ? restarted.failure.message
                : String(restarted.failure)
            }`,
          },
        })
        .pipe(Effect.catch(() => Effect.void));
    }
    return yield* Effect.fail(restarted.failure);
  });
}
