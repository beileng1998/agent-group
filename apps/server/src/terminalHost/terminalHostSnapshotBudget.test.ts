import { describe, expect, it } from "vitest";

import { HeadlessEmulator } from "./headless-emulator";
import type { TerminalSnapshot } from "./terminal-snapshot";
import {
  captureTerminalSnapshotWithinBudget,
  TerminalHostSnapshotTooLargeError,
  TERMINAL_HOST_SNAPSHOT_TOO_LARGE_MESSAGE,
  terminalSnapshotUtf8Bytes,
} from "./terminalHostSnapshotBudget";

function snapshot(scrollbackRows: number): TerminalSnapshot {
  return {
    snapshotAnsi: "界",
    scrollbackAnsi: "🙂".repeat(scrollbackRows),
    rehydrateSequences: "",
    modes: {
      bracketedPaste: false,
      mouseTracking: false,
      mouseTrackingMode: "none",
      sgrMouseMode: false,
      sgrMousePixelsMode: false,
      applicationCursor: false,
      alternateScreen: false,
    },
    cols: 80,
    rows: 24,
    scrollbackLines: 8,
    outputSequence: 3,
  };
}

describe("terminal snapshot byte budget", () => {
  it("counts UTF-8 bytes and progressively halves scrollback until it fits", () => {
    const requestedRows: Array<number | undefined> = [];
    const emulator = {
      getSnapshot: (input: { scrollbackRows?: number }) => {
        requestedRows.push(input.scrollbackRows);
        return snapshot(input.scrollbackRows ?? 8);
      },
    } as HeadlessEmulator;

    const captured = captureTerminalSnapshotWithinBudget({
      emulator,
      outputSequence: 3,
      maxBytes: 13,
    });

    expect(requestedRows).toEqual([undefined, 4, 2]);
    expect(captured.scrollbackAnsi).toBe("🙂🙂");
    expect(terminalSnapshotUtf8Bytes(captured)).toBe(13);
  });

  it("uses xterm's public scrollback option without truncating the viewport", async () => {
    const emulator = new HeadlessEmulator({
      cols: 20,
      rows: 2,
      scrollback: 20,
    });
    try {
      await emulator.write(
        Array.from({ length: 12 }, (_, index) => `line-${index}\r\n`).join(""),
      );
      const visibleOnly = emulator.getSnapshot({
        outputSequence: 1,
        scrollbackRows: 0,
      });
      const full = emulator.getSnapshot({ outputSequence: 1 });
      expect(terminalSnapshotUtf8Bytes(full)).toBeGreaterThan(
        terminalSnapshotUtf8Bytes(visibleOnly),
      );

      const captured = captureTerminalSnapshotWithinBudget({
        emulator,
        outputSequence: 1,
        maxBytes: terminalSnapshotUtf8Bytes(visibleOnly),
      });
      expect(terminalSnapshotUtf8Bytes(captured)).toBeLessThanOrEqual(
        terminalSnapshotUtf8Bytes(visibleOnly),
      );
      expect(captured.snapshotAnsi).toContain("line-11");
    } finally {
      emulator.dispose();
    }
  });

  it("fails with a stable error when the visible viewport alone exceeds the budget", () => {
    const emulator = {
      getSnapshot: (input: { scrollbackRows?: number }) =>
        snapshot(input.scrollbackRows ?? 8),
    } as HeadlessEmulator;

    expect(() =>
      captureTerminalSnapshotWithinBudget({
        emulator,
        outputSequence: 3,
        maxBytes: 4,
      }),
    ).toThrow(TerminalHostSnapshotTooLargeError);
    expect(() =>
      captureTerminalSnapshotWithinBudget({
        emulator,
        outputSequence: 3,
        scrollbackRows: 0,
        maxBytes: 4,
      }),
    ).toThrow(TERMINAL_HOST_SNAPSHOT_TOO_LARGE_MESSAGE);
  });
});
