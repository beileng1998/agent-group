import type { ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";

import type {
  ExecutionAdapterAuthorityShape,
  ExecutionAdapterAuthorityState,
} from "../Services/ExecutionAdapterAuthority";
import {
  makeExecutionAdapterAuthorityError as authorityError,
  terminalAuthorityAcceptsOperations,
} from "./executionAdapterAuthorityState";

export function makeTerminalAuthorityAssertion(
  getState: (threadId: ThreadId) => Effect.Effect<ExecutionAdapterAuthorityState>,
): ExecutionAdapterAuthorityShape["assertTerminal"] {
  return (threadId, revision, generation) =>
    getState(threadId).pipe(
      Effect.flatMap((state) => {
        if (state.adapter !== "terminal") {
          return Effect.fail(authorityError("not-terminal", `Thread ${threadId} is not terminal.`));
        }
        if (state.revision !== revision) {
          return Effect.fail(authorityError("stale-revision", "Terminal revision is stale."));
        }
        if (state.generation !== generation) {
          return Effect.fail(authorityError("stale-generation", "Terminal generation is stale."));
        }
        if (!terminalAuthorityAcceptsOperations(state.status)) {
          return Effect.fail(
            authorityError(
              "transition-in-progress",
              `Terminal revision ${revision} does not accept operations while ${state.status}.`,
            ),
          );
        }
        return Effect.succeed(state);
      }),
    );
}
