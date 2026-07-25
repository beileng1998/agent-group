import type { ThreadId } from "@agent-group/contracts";
import { Effect, Result } from "effect";

import type { ExecutionAdapterCoordinatorShape } from "../orchestration/Services/ExecutionAdapterCoordinator";
import { pauseTerminalRuntime } from "./terminalAgentRuntimeQuiesce";
import {
  terminalAgentCauseMessage,
  terminalAgentServiceError,
} from "./terminalAgentServiceErrors";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";

export function makeTerminalAgentCurrentAdapterStop(input: {
  readonly coordinator: ExecutionAdapterCoordinatorShape;
  readonly records: Map<ThreadId, TerminalAgentRuntimeRecord>;
  readonly ensureDetachedOwnerExited: (
    threadId: ThreadId,
    runtime: TerminalAgentRuntimeRecord | undefined,
  ) => Effect.Effect<void, unknown>;
  readonly abortForTeardown: (
    runtime: TerminalAgentRuntimeRecord,
    reason: string,
  ) => Effect.Effect<void, unknown>;
  readonly retireRuntime: (
    runtime: TerminalAgentRuntimeRecord,
  ) => Effect.Effect<void>;
}) {
  return Effect.fn(function* (
    threadId: ThreadId,
    stopStructured: () => Effect.Effect<void, unknown>,
  ) {
    const runtime = input.records.get(threadId);
    let terminalPrepared = false;
    const stopped = yield* Effect.result(
      input.coordinator
        .stopCurrentAdapter({
          threadId,
          stopStructured,
          beforeTerminalStop: () =>
            Effect.gen(function* () {
              if (!runtime) {
                yield* input.ensureDetachedOwnerExited(threadId, runtime);
              } else {
                yield* pauseTerminalRuntime(runtime);
                yield* input.abortForTeardown(runtime, "Agent Terminal stopped.");
              }
              terminalPrepared = true;
            }),
        })
        .pipe(
          Effect.mapError((cause) =>
            terminalAgentServiceError(
              "adapter",
              `Failed to stop the active execution adapter: ${terminalAgentCauseMessage(cause)}`,
              cause,
            ),
          ),
        ),
    );
    if (Result.isFailure(stopped)) {
      if (terminalPrepared) runtime?.resumeHook();
      return yield* Effect.fail(stopped.failure);
    }
    if (stopped.success === "terminal") {
      runtime?.unregisterHook();
      if (runtime) yield* input.retireRuntime(runtime);
      input.records.delete(threadId);
    }
    return stopped.success;
  });
}
