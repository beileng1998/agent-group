import type { ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";

import type { ExecutionAdapterAuthorityShape } from "../Services/ExecutionAdapterAuthority";

export function reconcileTerminalExit(input: {
  readonly authority: ExecutionAdapterAuthorityShape;
  readonly threadId: ThreadId;
  readonly revision: number;
  readonly generation: string;
  readonly exitCode: number;
  readonly signal: number | undefined;
  readonly persistenceAttempt?: number;
}): Effect.Effect<void> {
  const persistenceAttempt = input.persistenceAttempt ?? 0;
  return input.authority.getState(input.threadId).pipe(
    Effect.flatMap((state) => {
      if (
        state.adapter !== "terminal" ||
        state.revision !== input.revision ||
        (state.generation !== null && state.generation !== input.generation) ||
        state.status === "stopping" ||
        state.status === "deleting" ||
        state.status === "stopped"
      ) {
        return Effect.void;
      }
      return input.authority
        .updateTerminal({
          threadId: input.threadId,
          revision: input.revision,
          ...(state.generation !== null
            ? { generation: input.generation }
            : {}),
          requireNoClaims: true,
          patch: {
            status: "exited",
            exitCode: input.exitCode,
            exitSignal: input.signal ?? null,
            error:
              input.exitCode === 0
                ? null
                : `Terminal process exited with code ${input.exitCode}.`,
          },
        })
        .pipe(Effect.asVoid);
    }),
    Effect.catch((cause) => {
      if (cause.reason === "structured-operation-active") {
        return Effect.sleep("10 millis").pipe(
          Effect.andThen(reconcileTerminalExit(input)),
        );
      }
      if (cause.reason === "persistence-failed" && persistenceAttempt < 3) {
        return Effect.sleep(`${25 * 2 ** persistenceAttempt} millis`).pipe(
          Effect.andThen(
            reconcileTerminalExit({
              ...input,
              persistenceAttempt: persistenceAttempt + 1,
            }),
          ),
        );
      }
      if (
        cause.reason === "not-terminal" ||
        cause.reason === "stale-revision" ||
        cause.reason === "stale-generation"
      ) {
        return Effect.void;
      }
      return Effect.logError("terminal exit authority reconciliation failed", {
        threadId: input.threadId,
        revision: input.revision,
        generation: input.generation,
        cause,
      });
    }),
  );
}
