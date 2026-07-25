// FILE: terminalAgentRecoveryFailure.ts
// Purpose: Persist a fail-closed authority state after bounded startup recovery.
// Layer: Managed terminal recovery support

import { Effect } from "effect";

import type {
  StructuredAuthorityState,
  TerminalAuthorityState,
} from "../orchestration/Services/ExecutionAdapterAuthority";
import type { ExecutionAdapterCoordinatorShape } from "../orchestration/Services/ExecutionAdapterCoordinator";
import type { ThreadId } from "@agent-group/contracts";

export function makeTerminalRecoveryFailureHandler(
  coordinator: ExecutionAdapterCoordinatorShape,
) {
  return (
    threadId: ThreadId,
    expected: StructuredAuthorityState | TerminalAuthorityState,
    reason: string,
  ) =>
    expected.adapter === "structured"
      ? Effect.void
      : Effect.gen(function* () {
          const current = yield* coordinator.getState(threadId);
          if (
            current.adapter !== "terminal" ||
            current.revision !== expected.revision ||
            current.runtimeInstanceId !== expected.runtimeInstanceId
          ) {
            return;
          }
          yield* coordinator.updateTerminalState({
            threadId,
            revision: current.revision,
            ...(current.generation !== null
              ? { generation: current.generation }
              : {}),
            patch: {
              status: "error",
              activeTurnId: null,
              error: reason,
            },
          });
        });
}
