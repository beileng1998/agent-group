// FILE: TerminalHostTypes.ts
// Purpose: Public contracts and typed failures for the managed terminal host.
// Layer: Server terminal host contract

import type { PtyProcess, PtySpawnInput } from "../terminal/Services/PTY";
import type { CapturedProcessTree, ProcessTreeKiller } from "../terminal/processTreeKiller";
import type {
  TerminalProcessGroupController,
  TerminalProcessGroupIdentity,
} from "../terminal/terminalProcessGroup";
import type { HeadlessEmulator } from "./headless-emulator";
import type { TerminalSnapshot } from "./terminal-snapshot";

export type TerminalHostGeneration = string;

export interface TerminalHostSpawnInput {
  readonly sessionId: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly env?: Record<string, string>;
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalHostAttachResult {
  readonly isNew: boolean;
  readonly generation: TerminalHostGeneration;
  readonly pid: number;
  readonly processGroupIdentity: TerminalProcessGroupIdentity | null;
  /** Null on a fresh spawn; on reattach carries outputSequence for seq dedupe. */
  readonly snapshot: TerminalSnapshot | null;
}

export interface TerminalHostOutput {
  readonly seq: number;
  readonly data: string;
  readonly generation: TerminalHostGeneration;
}

export interface TerminalHostExit {
  readonly exitCode: number;
  readonly signal?: number;
  readonly generation: TerminalHostGeneration;
}

export interface TerminalHostClientSubscription {
  readonly attached: TerminalHostAttachResult;
  readonly unsubscribe: () => void;
}

export class TerminalHostSessionNotFoundError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`Terminal host session not found: ${sessionId}`);
    this.name = "TerminalHostSessionNotFoundError";
    this.sessionId = sessionId;
  }
}

export class TerminalHostStaleGenerationError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`Stale generation for terminal host session: ${sessionId}`);
    this.name = "TerminalHostStaleGenerationError";
    this.sessionId = sessionId;
  }
}

export class TerminalHostTeardownError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string, detail: string) {
    super(`Terminal host teardown could not be verified for ${sessionId}: ${detail}`);
    this.name = "TerminalHostTeardownError";
    this.sessionId = sessionId;
  }
}

export interface TerminalHostDependencies {
  /** Spawn bridge; the Effect service supplies the runtime PTY adapter. */
  readonly spawnPty: (input: PtySpawnInput) => Promise<PtyProcess>;
  readonly processTreeKiller?: ProcessTreeKiller;
  readonly processGroupController?: TerminalProcessGroupController;
  readonly requireProcessGroupOwnership?: boolean;
  readonly platform?: NodeJS.Platform;
  /** Grace period between cooperative and forced process-tree teardown. */
  readonly killGraceMs?: number;
  /** Test seam; production uses the managed-terminal wire budget. */
  readonly maxSnapshotBytes?: number;
}

/** Internal mutable owner state; exported only to keep TerminalHost focused. */
export interface TerminalHostSession {
  readonly sessionId: string;
  readonly generation: TerminalHostGeneration;
  readonly pty: PtyProcess;
  readonly emulator: HeadlessEmulator;
  readonly outputListeners: Set<(output: TerminalHostOutput) => void>;
  readonly exitListeners: Set<(exit: TerminalHostExit) => void>;
  seq: number;
  isAlive: boolean;
  exitCode: number | null;
  emulatorQueue: Promise<void>;
  emulatorError: unknown | null;
  queuedEmulatorBytes: number;
  ptyPaused: boolean;
  disposePtyData: () => void;
  disposePtyExit: () => void;
  teardownTree: CapturedProcessTree | null;
  lastTreeCaptureAt: number;
  processGroupIdentity: TerminalProcessGroupIdentity | null;
}
