import type { ThreadId } from "@agent-group/contracts";

import { terminalOwnerIdentityMatches } from "../../terminal/terminalProcessIdentity";
import {
  ExecutionAdapterAuthorityError,
  type ExecutionAdapterAuthorityShape,
  type ExecutionAdapterTerminalStatus,
  type ExecutionAdapterAuthorityState,
  type StructuredAuthorityState,
  type TerminalAuthorityState,
} from "../Services/ExecutionAdapterAuthority";
import type { ExecutionAdapterClaimRecord } from "./executionAdapterAuthorityClaims";

export interface ExecutionAdapterAuthorityRuntimeState {
  readonly states: Map<ThreadId, ExecutionAdapterAuthorityState>;
  readonly claims: Map<ThreadId, Map<string, ExecutionAdapterClaimRecord>>;
}

export const makeStructuredAuthorityState = (
  revision = 0,
): StructuredAuthorityState => ({
  adapter: "structured",
  revision,
  status: "ready",
});

export const makeExecutionAdapterAuthorityError = (
  reason: ExecutionAdapterAuthorityError["reason"],
  message: string,
) => new ExecutionAdapterAuthorityError({ reason, message });

export function completeTerminalStartState(
  current: ExecutionAdapterAuthorityState,
  next: Parameters<ExecutionAdapterAuthorityShape["completeTerminalStart"]>[0],
): TerminalAuthorityState | ExecutionAdapterAuthorityError {
  if (current.adapter !== "terminal") {
    return makeExecutionAdapterAuthorityError(
      "not-terminal",
      `Thread ${next.threadId} is not terminal.`,
    );
  }
  if (current.revision !== next.revision) {
    return makeExecutionAdapterAuthorityError(
      "stale-revision",
      `Terminal revision ${next.revision} is stale.`,
    );
  }
  if (current.status !== "starting") {
    return makeExecutionAdapterAuthorityError(
      "transition-in-progress",
      `Terminal revision ${next.revision} is no longer starting.`,
    );
  }
  if (next.ownerIdentity.pid !== next.pid) {
    return makeExecutionAdapterAuthorityError(
      "transition-in-progress",
      `Terminal PID ${next.pid} does not match its captured owner identity.`,
    );
  }
  if (
    next.processGroupIdentity !== null &&
    (next.processGroupIdentity.pgid !== next.pid ||
      !terminalOwnerIdentityMatches(
        next.ownerIdentity,
        next.processGroupIdentity.leaderIdentity,
      ))
  ) {
    return makeExecutionAdapterAuthorityError(
      "transition-in-progress",
      `Terminal PID ${next.pid} does not match its process-group identity.`,
    );
  }
  return {
    ...current,
    status: "ready",
    generation: next.generation,
    pid: next.pid,
    ownerIdentity: next.ownerIdentity,
    processGroupIdentity: next.processGroupIdentity,
  };
}

const TERMINAL_OPERATION_STATUSES = new Set<ExecutionAdapterTerminalStatus>([
  "checking",
  "ready",
  "running",
  "attention",
  "context-blocked",
  "error",
]);

export const terminalAuthorityAcceptsOperations = (
  status: ExecutionAdapterTerminalStatus,
): boolean => TERMINAL_OPERATION_STATUSES.has(status);

export function terminalStatusUpdateAllowed(
  current: ExecutionAdapterTerminalStatus,
  next: ExecutionAdapterTerminalStatus,
): boolean {
  if (current === "deleting") return next === "deleting";
  if (current === "stopped") return next === "stopped" || next === "error";
  if (current === "stopping") return next === "stopping" || next === "stopped" || next === "error";
  if (current === "exited") return next === "exited" || next === "error";
  return true;
}
