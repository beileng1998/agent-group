// FILE: terminalAgentPersistedRecovery.ts
// Purpose: Crash-recovery guard and private runtime-directory retirement.
// Layer: Managed terminal service support

import {
  TerminalAgentProvider,
  type ThreadId,
} from "@agent-group/contracts";
import { Effect, Schema } from "effect";

import type { ExecutionAdapterState } from "../orchestration/Services/ExecutionAdapterCoordinator";
import type { TerminalAuthorityState } from "../orchestration/Services/ExecutionAdapterAuthority";
import { terminalAgentRuntimeDir } from "./terminalAgentDriverRegistry";
import { waitForPersistedTerminalOwnerExit } from "./terminalAgentProcessRecovery";
import { retireTerminalRuntimeDirectory } from "./terminalAgentRuntimeCleanup";
import { terminalAgentServiceError } from "./terminalAgentServiceErrors";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";

export function makeTerminalAgentPersistedRecovery(input: {
  readonly stateDir: string;
  readonly records: Map<ThreadId, TerminalAgentRuntimeRecord>;
}) {
  const ensureOwnerExited = (
    owner: Pick<
      TerminalAuthorityState,
      "pid" | "ownerIdentity" | "processGroupIdentity"
    >,
  ) =>
    Effect.tryPromise({
      try: async () => {
        const verified = await waitForPersistedTerminalOwnerExit(owner);
        if (!verified.verified) {
          throw new Error(
            verified.detail ?? "The previous terminal process exit is unverified.",
          );
        }
      },
      catch: (cause) =>
        terminalAgentServiceError(
          "invalid-state",
          `Agent Terminal recovery is blocked: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          cause,
        ),
    });

  const ensureDetachedOwnerExited = (
    state: ExecutionAdapterState,
    runtime: TerminalAgentRuntimeRecord | undefined,
  ) =>
    state.adapter === "terminal" &&
    runtime === undefined &&
    !(
      state.status === "stopped" &&
      state.pid === null &&
      state.ownerIdentity === null &&
      state.processGroupIdentity === null
    )
      ? ensureOwnerExited(state)
      : Effect.void;

  const retirePreviousRuntime = (
    threadId: ThreadId,
    state: ExecutionAdapterState,
  ) => {
    if (
      state.adapter !== "terminal" ||
      !Schema.is(TerminalAgentProvider)(state.provider)
    ) {
      return Effect.void;
    }
    const runtimeDir = terminalAgentRuntimeDir({
      stateDir: input.stateDir,
      threadId,
      runtimeInstanceId: state.runtimeInstanceId,
      provider: state.provider,
    });
    if (input.records.get(threadId)?.runtimeDir === runtimeDir) {
      return Effect.void;
    }
    return Effect.tryPromise(() =>
      retireTerminalRuntimeDirectory(input.stateDir, runtimeDir),
    ).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("persisted Agent Terminal runtime cleanup failed", {
          threadId,
          runtimeDir,
          cause,
        }),
      ),
    );
  };

  return {
    ensureOwnerExited,
    ensureDetachedOwnerExited,
    retirePreviousRuntime,
  };
}
