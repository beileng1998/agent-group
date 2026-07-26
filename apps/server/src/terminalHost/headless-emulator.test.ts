// FILE: headless-emulator.test.ts
// Purpose: Verifies the vendored headless screen model — serialized snapshots,
// alternate-screen buffer split, mode rehydration, and partial escape tails —
// using only xterm public addons.
// Layer: Server terminal host tests

import { TERMINAL_AGENT_SCROLLBACK_ROWS } from "@agent-group/shared/terminalAgent";
import { describe, expect, it } from "vitest";

import { HeadlessEmulator } from "./headless-emulator";

async function withEmulator<T>(
  test: (emulator: HeadlessEmulator) => Promise<T> | T,
): Promise<T> {
  const emulator = new HeadlessEmulator({ cols: 80, rows: 24 });
  try {
    return await test(emulator);
  } finally {
    emulator.dispose();
  }
}

describe("HeadlessEmulator", () => {
  it("bounds retained scrollback by the managed Terminal product budget", async () => {
    const emulator = new HeadlessEmulator({ cols: 20, rows: 2 });
    try {
      await emulator.write(
        Array.from(
          { length: TERMINAL_AGENT_SCROLLBACK_ROWS + 50 },
          (_, index) => `line-${index}\r\n`,
        ).join(""),
      );
      const snapshot = emulator.getSnapshot({ outputSequence: 1 });
      expect(snapshot.scrollbackLines).toBeLessThanOrEqual(
        TERMINAL_AGENT_SCROLLBACK_ROWS,
      );
      expect(snapshot.snapshotAnsi).toContain(
        `line-${TERMINAL_AGENT_SCROLLBACK_ROWS + 49}`,
      );
    } finally {
      emulator.dispose();
    }
  });

  it("forwards xterm query replies only for flagged live writes", async () => {
    const replies: string[] = [];
    const emulator = new HeadlessEmulator({
      cols: 80,
      rows: 24,
      onQueryReply: (reply) => replies.push(reply),
    });
    try {
      await emulator.write("\x1b[6n");
      expect(replies).toEqual([]);
      await emulator.write("\x1b[6n", { forwardQueryReplies: true });
      expect(replies).toEqual(["\x1b[1;1R"]);
    } finally {
      emulator.dispose();
    }
  });

  it("serializes written content into a snapshot", async () => {
    await withEmulator(async (emulator) => {
      await emulator.write("hello terminal");
      const snapshot = emulator.getSnapshot({ outputSequence: 1 });
      expect(snapshot.snapshotAnsi).toContain("hello terminal");
      expect(snapshot.cols).toBe(80);
      expect(snapshot.rows).toBe(24);
      expect(snapshot.outputSequence).toBe(1);
      expect(snapshot.modes.alternateScreen).toBe(false);
      expect(snapshot.scrollbackAnsi).toBe("");
    });
  });

  it("uses Unicode 11 character widths", async () => {
    const emulator = new HeadlessEmulator({ cols: 2, rows: 2 });
    try {
      await emulator.write("🧑X");
      expect(emulator.getVisibleLines()).toEqual(["🧑", "X"]);
    } finally {
      emulator.dispose();
    }
  });

  it("splits the normal buffer out and rehydrates the alt-screen transition", async () => {
    await withEmulator(async (emulator) => {
      await emulator.write("normal-buffer-line\r\n");
      await emulator.write("\x1b[?1049h");
      await emulator.write("alt-screen-app");
      const snapshot = emulator.getSnapshot({ outputSequence: 2 });
      expect(snapshot.modes.alternateScreen).toBe(true);
      expect(snapshot.rehydrateSequences).toContain("\x1b[?1049h");
      expect(snapshot.scrollbackAnsi).toContain("normal-buffer-line");
      expect(snapshot.snapshotAnsi).toContain("alt-screen-app");
      expect(snapshot.snapshotAnsi).not.toContain("normal-buffer-line");
    });
  });

  it("rehydrates bracketed paste mode", async () => {
    await withEmulator(async (emulator) => {
      await emulator.write("\x1b[?2004h");
      const snapshot = emulator.getSnapshot({ outputSequence: 1 });
      expect(snapshot.modes.bracketedPaste).toBe(true);
      expect(snapshot.rehydrateSequences).toContain("\x1b[?2004h");
    });
  });

  it("carries a dangling partial escape sequence as pendingEscapeTailAnsi", async () => {
    await withEmulator(async (emulator) => {
      await emulator.write("text\x1b[?25");
      const snapshot = emulator.getSnapshot({ outputSequence: 1 });
      expect(snapshot.pendingEscapeTailAnsi).toBe("\x1b[?25");
      await emulator.write("l");
      const completed = emulator.getSnapshot({ outputSequence: 2 });
      expect(completed.pendingEscapeTailAnsi).toBeUndefined();
    });
  });

  it("tracks applied size across resize", async () => {
    await withEmulator(async (emulator) => {
      emulator.resize(120, 40);
      expect(emulator.getAppliedSize()).toEqual({ cols: 120, rows: 40 });
      const snapshot = emulator.getSnapshot({ outputSequence: 1 });
      expect(snapshot.cols).toBe(120);
      expect(snapshot.rows).toBe(40);
    });
  });
});
