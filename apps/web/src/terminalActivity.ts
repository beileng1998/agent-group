import type { TerminalEvent } from "@agent-group/contracts";
import type { TerminalActivityState } from "@agent-group/shared/terminalThreads";

export interface TerminalActivityUpdate {
  agentState: TerminalActivityState | null;
  hasRunningSubprocess: boolean;
}

export function terminalActivityFromEvent(event: TerminalEvent): TerminalActivityUpdate | null {
  switch (event.type) {
    case "activity":
      return {
        hasRunningSubprocess: event.hasRunningSubprocess,
        agentState: event.agentState,
      };
    case "started":
    case "restarted":
    case "exited":
      return {
        hasRunningSubprocess: false,
        agentState: null,
      };
    default:
      return null;
  }
}
