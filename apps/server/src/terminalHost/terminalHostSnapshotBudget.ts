import { TERMINAL_AGENT_SNAPSHOT_MAX_BYTES } from "@agent-group/contracts";

import type { HeadlessEmulator } from "./headless-emulator";
import type { TerminalSnapshot } from "./terminal-snapshot";

const RESET_TERMINAL_ANSI = "\u001bc";

export const TERMINAL_HOST_SNAPSHOT_TOO_LARGE_MESSAGE =
  "Managed terminal snapshot exceeds the UTF-8 byte limit without scrollback.";

export class TerminalHostSnapshotTooLargeError extends Error {
  constructor() {
    super(TERMINAL_HOST_SNAPSHOT_TOO_LARGE_MESSAGE);
    this.name = "TerminalHostSnapshotTooLargeError";
  }
}

export function terminalSnapshotUtf8Bytes(snapshot: TerminalSnapshot): number {
  return (
    Buffer.byteLength(RESET_TERMINAL_ANSI) +
    Buffer.byteLength(snapshot.snapshotAnsi) +
    Buffer.byteLength(snapshot.scrollbackAnsi) +
    Buffer.byteLength(snapshot.rehydrateSequences) +
    Buffer.byteLength(snapshot.pendingEscapeTailAnsi ?? "")
  );
}

/**
 * Serialize entirely through xterm, reducing only retained scrollback until the
 * wire payload fits. The visible viewport is never truncated.
 */
export function captureTerminalSnapshotWithinBudget(input: {
  readonly emulator: HeadlessEmulator;
  readonly outputSequence: number;
  readonly scrollbackRows?: number;
  readonly maxBytes?: number;
}): TerminalSnapshot {
  const maxBytes = input.maxBytes ?? TERMINAL_AGENT_SNAPSHOT_MAX_BYTES;
  let scrollbackRows = input.scrollbackRows;

  while (true) {
    const snapshot = input.emulator.getSnapshot({
      outputSequence: input.outputSequence,
      ...(scrollbackRows !== undefined ? { scrollbackRows } : {}),
    });
    if (terminalSnapshotUtf8Bytes(snapshot) <= maxBytes) return snapshot;

    const retainedRows =
      scrollbackRows === undefined
        ? snapshot.scrollbackLines
        : Math.min(scrollbackRows, snapshot.scrollbackLines);
    if (retainedRows <= 0) throw new TerminalHostSnapshotTooLargeError();
    scrollbackRows = Math.floor(retainedRows / 2);
  }
}
