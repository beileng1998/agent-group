import { describe, expect, it } from "vitest";

import {
  buildTerminalArrowSequence,
  buildTerminalSgrWheelReport,
  consumeTerminalWheelLines,
  createTerminalWheelLineState,
} from "./terminalScrollCompatibility";

const context = {
  cellHeight: 18,
  context: "alternate:none:false",
  fastScrollSensitivity: 5,
  rows: 24,
  scrollSensitivity: 1,
};

describe("terminal scroll compatibility", () => {
  it("accumulates trackpad pixels until they form complete terminal lines", () => {
    const state = createTerminalWheelLineState();
    const input = { altKey: false, ctrlKey: false, deltaMode: 0, deltaY: 6 };

    expect(consumeTerminalWheelLines(state, input, context)).toBe(0);
    expect(consumeTerminalWheelLines(state, input, context)).toBe(0);
    expect(consumeTerminalWheelLines(state, input, context)).toBe(1);
    expect(state.partialLines).toBeCloseTo(0);
  });

  it("preserves the full line magnitude of a single wheel event", () => {
    const state = createTerminalWheelLineState();

    expect(
      consumeTerminalWheelLines(
        state,
        { altKey: false, ctrlKey: false, deltaMode: 0, deltaY: -72 },
        context,
      ),
    ).toBe(-4);
  });

  it("resets fractional movement when the terminal mode changes", () => {
    const state = createTerminalWheelLineState();
    const input = { altKey: false, ctrlKey: false, deltaMode: 0, deltaY: 12 };

    expect(consumeTerminalWheelLines(state, input, context)).toBe(0);
    expect(
      consumeTerminalWheelLines(state, input, { ...context, context: "alternate:vt200:sgr" }),
    ).toBe(0);
  });

  it("applies line, page, fast-scroll, and flood limits", () => {
    const state = createTerminalWheelLineState();

    expect(
      consumeTerminalWheelLines(
        state,
        { altKey: true, ctrlKey: false, deltaMode: 1, deltaY: 2 },
        context,
      ),
    ).toBe(10);
    expect(
      consumeTerminalWheelLines(
        state,
        { altKey: false, ctrlKey: false, deltaMode: 2, deltaY: 4 },
        context,
      ),
    ).toBe(24);
  });

  it("builds cursor and SGR wheel sequences", () => {
    expect(buildTerminalArrowSequence(-1, false)).toBe("\x1b[A");
    expect(buildTerminalArrowSequence(1, true)).toBe("\x1bOB");
    expect(buildTerminalSgrWheelReport(1, 12, 7, { altKey: true, ctrlKey: true })).toBe(
      "\x1b[<89;12;7M",
    );
  });
});
