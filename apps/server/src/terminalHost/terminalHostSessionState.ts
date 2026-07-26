import type { PtyProcess } from "../terminal/Services/PTY";
import type { TerminalProcessGroupIdentity } from "../terminal/terminalProcessGroup";
import type { HeadlessEmulator } from "./headless-emulator";
import type { TerminalHostGeneration, TerminalHostSession } from "./TerminalHostTypes";

export function makeTerminalHostSessionState(input: {
  readonly sessionId: string;
  readonly generation: TerminalHostGeneration;
  readonly pty: PtyProcess;
  readonly emulator: HeadlessEmulator;
  readonly processGroupIdentity: TerminalProcessGroupIdentity | null;
}): TerminalHostSession {
  return {
    ...input,
    outputListeners: new Set(),
    exitListeners: new Set(),
    seq: 0,
    isAlive: true,
    exitCode: null,
    emulatorQueue: Promise.resolve(),
    emulatorError: null,
    queuedEmulatorBytes: 0,
    ptyPaused: false,
    disposePtyData: () => {},
    disposePtyExit: () => {},
    teardownTree: null,
    lastTreeCaptureAt: 0,
  };
}
