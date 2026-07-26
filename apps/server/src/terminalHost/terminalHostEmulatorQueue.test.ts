import { describe, expect, it, vi } from "vitest";

import { HeadlessEmulator } from "./headless-emulator";
import {
  TERMINAL_HOST_EMULATOR_MAX_QUEUED_BYTES,
  TerminalHostEmulatorQueueOverflowError,
  enqueueTerminalEmulatorTask,
  enqueueTerminalSnapshot,
} from "./terminalHostEmulatorQueue";
import type { TerminalHostSession } from "./TerminalHostTypes";

describe("terminal host emulator queue", () => {
  it("keeps parsing PTY writes after a snapshot budget rejection", async () => {
    const emulator = new HeadlessEmulator({ cols: 20, rows: 2 });
    const session = {
      sessionId: "snapshot-budget-failure",
      emulator,
      emulatorQueue: Promise.resolve(),
      emulatorError: null,
      queuedEmulatorBytes: 0,
      ptyPaused: false,
      pty: {
        pause: vi.fn(),
        resume: vi.fn(),
      },
      seq: 1,
    } as unknown as TerminalHostSession;

    try {
      await emulator.write("visible");
      await expect(enqueueTerminalSnapshot({ session, maxBytes: 1 })).rejects.toThrow(
        /UTF-8 byte limit/,
      );

      enqueueTerminalEmulatorTask({
        session,
        task: () => emulator.write("-after"),
      });
      await session.emulatorQueue;

      expect(session.emulatorError).toBeNull();
      expect(emulator.getSnapshot({ outputSequence: 2 }).snapshotAnsi).toContain("visible-after");
    } finally {
      emulator.dispose();
    }
  });

  it("fails closed instead of growing without bound when PTY pause is advisory", () => {
    const pause = vi.fn();
    const task = vi.fn();
    const session = {
      emulatorQueue: Promise.resolve(),
      emulatorError: null,
      queuedEmulatorBytes: TERMINAL_HOST_EMULATOR_MAX_QUEUED_BYTES - 1,
      ptyPaused: false,
      pty: {
        pause,
        resume: vi.fn(),
      },
    } as unknown as TerminalHostSession;

    const accepted = enqueueTerminalEmulatorTask({
      session,
      task,
      queuedBytes: 2,
    });

    expect(accepted).toBe(false);
    expect(session.queuedEmulatorBytes).toBe(TERMINAL_HOST_EMULATOR_MAX_QUEUED_BYTES - 1);
    expect(session.emulatorError).toBeInstanceOf(TerminalHostEmulatorQueueOverflowError);
    expect(pause).toHaveBeenCalledOnce();
    expect(task).not.toHaveBeenCalled();
  });
});
