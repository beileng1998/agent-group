import type { TerminalSnapshot } from "./terminal-snapshot";
import type { TerminalHostSession } from "./TerminalHostTypes";
import { captureTerminalSnapshotWithinBudget } from "./terminalHostSnapshotBudget";

const EMULATOR_PAUSE_BYTES = 4 * 1024 * 1024;
const EMULATOR_RESUME_BYTES = 1024 * 1024;
export const TERMINAL_HOST_EMULATOR_MAX_QUEUED_BYTES = 16 * 1024 * 1024;

export class TerminalHostEmulatorQueueOverflowError extends Error {
  constructor() {
    super("Managed terminal emulator queue exceeded its byte limit.");
    this.name = "TerminalHostEmulatorQueueOverflowError";
  }
}

export function enqueueTerminalEmulatorTask(input: {
  readonly session: TerminalHostSession;
  readonly task: () => void | Promise<void>;
  readonly queuedBytes?: number;
}): boolean {
  const queuedBytes = input.queuedBytes ?? 0;
  if (
    queuedBytes > 0 &&
    input.session.queuedEmulatorBytes + queuedBytes > TERMINAL_HOST_EMULATOR_MAX_QUEUED_BYTES
  ) {
    input.session.emulatorError ??= new TerminalHostEmulatorQueueOverflowError();
    if (!input.session.ptyPaused) {
      input.session.ptyPaused = true;
      input.session.pty.pause();
    }
    return false;
  }
  input.session.queuedEmulatorBytes += queuedBytes;
  if (!input.session.ptyPaused && input.session.queuedEmulatorBytes >= EMULATOR_PAUSE_BYTES) {
    input.session.ptyPaused = true;
    input.session.pty.pause();
  }
  input.session.emulatorQueue = input.session.emulatorQueue
    .then(input.task)
    .catch((cause) => {
      input.session.emulatorError ??= cause;
    })
    .then(() => {
      input.session.queuedEmulatorBytes = Math.max(
        0,
        input.session.queuedEmulatorBytes - queuedBytes,
      );
      if (input.session.ptyPaused && input.session.queuedEmulatorBytes <= EMULATOR_RESUME_BYTES) {
        input.session.ptyPaused = false;
        input.session.pty.resume();
      }
    });
  return true;
}

export async function enqueueTerminalSnapshot(input: {
  readonly session: TerminalHostSession;
  readonly scrollbackRows?: number;
  readonly maxBytes?: number;
}): Promise<TerminalSnapshot> {
  const outputSequence = input.session.seq;
  let snapshot: TerminalSnapshot | undefined;
  const snapshotTask = input.session.emulatorQueue.then(() => {
    if (input.session.emulatorError !== null) {
      throw input.session.emulatorError;
    }
    snapshot = captureTerminalSnapshotWithinBudget({
      emulator: input.session.emulator,
      outputSequence,
      ...(input.scrollbackRows !== undefined ? { scrollbackRows: input.scrollbackRows } : {}),
      ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
    });
  });
  // A transport budget failure is not an emulator parse failure. Keep later
  // PTY writes flowing while returning this capture's error to its caller.
  input.session.emulatorQueue = snapshotTask.then(
    () => undefined,
    () => undefined,
  );
  await snapshotTask;
  if (snapshot === undefined) {
    throw new Error(`Terminal host snapshot failed: ${input.session.sessionId}`);
  }
  return snapshot;
}
