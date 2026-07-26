import { Effect } from "effect";

import { finalizeAgentGroupTurn } from "../agentGroup/runtime";
import type { ExecutionAdapterCoordinatorShape } from "../orchestration/Services/ExecutionAdapterCoordinator";
import {
  abortTerminalAgentTurn,
  type RuntimeEventDependencies,
} from "./terminalAgentRuntimeEvents";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";
import { retireTerminalTurnContexts } from "./terminalAgentTurnCleanup";

export function abortTerminalTurnForTeardown(input: {
  readonly runtime: TerminalAgentRuntimeRecord;
  readonly reason: string;
  readonly coordinator: ExecutionAdapterCoordinatorShape;
  readonly eventDependencies: RuntimeEventDependencies;
  readonly updateAuthority?: boolean;
}) {
  return Effect.tryPromise(() =>
    abortTerminalAgentTurn(input.eventDependencies, input.reason, {
      updateAuthority: input.updateAuthority ?? true,
    }),
  ).pipe(
    Effect.catch((cause) =>
      Effect.gen(function* () {
        const turn = input.runtime.activeTurn;
        const state = yield* input.coordinator.getState(input.runtime.threadId);
        if (state.adapter === "terminal" && state.revision === input.runtime.revision) {
          yield* input.coordinator
            .updateTerminalState({
              threadId: input.runtime.threadId,
              revision: input.runtime.revision,
              ...(input.runtime.generation ? { generation: input.runtime.generation } : {}),
              patch: {
                status:
                  state.status === "stopping" ||
                  state.status === "stopped" ||
                  state.status === "exited"
                    ? state.status
                    : "attention",
                activeTurnId: null,
                error: input.reason,
              },
            })
            .pipe(Effect.catch(() => Effect.void));
        }
        if (turn?.tracksAgentGroupContext) {
          yield* Effect.promise(() =>
            finalizeAgentGroupTurn({
              ...input.runtime.coordinates,
              turnId: turn.turnId,
              successful: false,
            }).catch(() => null),
          );
        }
        if (turn) {
          yield* Effect.promise(() => retireTerminalTurnContexts(input.runtime, turn));
        }
        input.runtime.activeTurn = null;
        yield* Effect.logWarning("managed terminal turn projection failed during teardown", {
          threadId: input.runtime.threadId,
          cause,
        });
      }),
    ),
  );
}
