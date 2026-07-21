import type { TerminalSessionSnapshot } from "@agent-group/contracts";
import type { Terminal } from "@xterm/xterm";

import type { TerminalRuntimeEntry } from "../terminalRuntimeTypes";

export type AgentGroupTerminalOptions = NonNullable<ConstructorParameters<typeof Terminal>[0]> & {
  fontWeight?: string | number;
  fontWeightBold?: string | number;
  scrollbar?: { showScrollbar?: boolean };
  vtExtensions?: { kittyKeyboard?: boolean };
};

export const TERMINAL_CURSOR_STYLE: NonNullable<AgentGroupTerminalOptions["cursorStyle"]> = "bar";
export const TERMINAL_INACTIVE_CURSOR_STYLE: NonNullable<
  AgentGroupTerminalOptions["cursorInactiveStyle"]
> = "bar";
export const TERMINAL_CURSOR_WIDTH = 1;

export function setTerminalRuntimeStatus(
  entry: TerminalRuntimeEntry,
  status: TerminalRuntimeEntry["runtimeStatus"],
): void {
  if (entry.runtimeStatus === status) return;
  entry.runtimeStatus = status;
  entry.callbacks.onTerminalRuntimeStatusChange?.(entry.terminalId, status);
}

export function buildTerminalOpenInput(entry: TerminalRuntimeEntry) {
  return {
    threadId: entry.threadId,
    terminalId: entry.terminalId,
    cwd: entry.cwd,
    cols: entry.terminal.cols,
    rows: entry.terminal.rows,
    ...(entry.runtimeEnv ? { env: entry.runtimeEnv } : {}),
  };
}

export function terminalSnapshotHasReplayPayload(snapshot: TerminalSessionSnapshot): boolean {
  return snapshot.history.length > 0 || (snapshot.replayPreamble?.length ?? 0) > 0;
}
