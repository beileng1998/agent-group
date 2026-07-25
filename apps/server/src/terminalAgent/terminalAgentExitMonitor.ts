import type { ThreadId } from "@agent-group/contracts";
import { Effect, Stream } from "effect";

import type { ExecutionAdapterCoordinatorShape } from "../orchestration/Services/ExecutionAdapterCoordinator";
import type { RuntimeEventDependencies } from "./terminalAgentRuntimeEvents";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";
import { abortTerminalTurnForTeardown } from "./terminalAgentTeardown";

export function monitorTerminalAgentExits(input: {
  readonly coordinator: ExecutionAdapterCoordinatorShape;
  readonly records: Map<ThreadId, TerminalAgentRuntimeRecord>;
  readonly eventDependencies: (
    runtime: TerminalAgentRuntimeRecord,
  ) => RuntimeEventDependencies;
  readonly retireRuntime: (
    runtime: TerminalAgentRuntimeRecord,
  ) => Effect.Effect<void>;
  readonly serialize: (
    threadId: ThreadId,
    operation: Effect.Effect<void>,
  ) => Effect.Effect<void>;
}) {
  return Stream.runForEach(input.coordinator.streamChanges, (change) =>
    input.serialize(
      change.threadId,
      Effect.gen(function* () {
        const runtime = input.records.get(change.threadId);
        if (!runtime) return;
        if (change.state.adapter === "structured") {
          const current = yield* input.coordinator.getState(change.threadId);
          if (
            current.adapter !== "structured" ||
            input.records.get(change.threadId) !== runtime
          ) {
            return;
          }
          runtime.unregisterHook();
          input.records.delete(change.threadId);
          yield* input.retireRuntime(runtime);
          return;
        }
        if (
          change.state.status !== "exited" ||
          change.state.revision !== runtime.revision ||
          change.state.generation !== runtime.generation
        ) {
          return;
        }
        runtime.unregisterHook();
        yield* abortTerminalTurnForTeardown({
          runtime,
          reason: change.state.error ?? "Agent Terminal process exited.",
          coordinator: input.coordinator,
          eventDependencies: input.eventDependencies(runtime),
          updateAuthority: false,
        });
        const current = yield* input.coordinator.getState(change.threadId);
        if (
          input.records.get(change.threadId) !== runtime ||
          current.adapter !== "terminal" ||
          current.status !== "exited" ||
          current.revision !== runtime.revision ||
          current.generation !== runtime.generation
        ) {
          return;
        }
        yield* input.coordinator
          .updateTerminalState({
            threadId: change.threadId,
            revision: current.revision,
            generation: current.generation,
            patch: {
              status: "exited",
              activeTurnId: null,
            },
          })
          .pipe(
            Effect.catch((cause) =>
              Effect.logWarning("managed terminal exit evidence could not be finalized", {
                threadId: change.threadId,
                cause,
              }),
            ),
          );
        if (input.records.get(change.threadId) !== runtime) return;
        runtime.handshakeReceived = false;
        yield* input.retireRuntime(runtime);
      }),
    ),
  );
}
