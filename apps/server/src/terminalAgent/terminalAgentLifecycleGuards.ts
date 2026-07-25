import type { ExecutionAdapterState } from "../orchestration/Services/ExecutionAdapterCoordinator";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";

export function terminalTurnIsInFlight(
  authority: ExecutionAdapterState,
  runtime: TerminalAgentRuntimeRecord | undefined,
): boolean {
  return (
    authority.adapter === "terminal" &&
    (authority.activeTurnId !== null ||
      authority.status === "running" ||
      (runtime !== undefined && runtime.activeTurn !== null))
  );
}
