import { describe, expect, it } from "vitest";

import {
  classifyTerminalTurnApplicability,
  isStartedTurnApplicable,
} from "./terminalTurnApplicability.ts";

describe("isStartedTurnApplicable", () => {
  it("accepts the first start and a repeated start for the active turn", () => {
    expect(isStartedTurnApplicable({ activeTurnId: null, eventTurnId: "turn-first" })).toBe(true);
    expect(isStartedTurnApplicable({ activeTurnId: "turn-first", eventTurnId: "turn-first" })).toBe(
      true,
    );
  });

  it("rejects a start for a different active turn", () => {
    expect(
      isStartedTurnApplicable({ activeTurnId: "turn-active", eventTurnId: "turn-conflict" }),
    ).toBe(false);
  });

  it("preserves providers that omit an id from started events", () => {
    expect(isStartedTurnApplicable({ activeTurnId: "turn-active", eventTurnId: undefined })).toBe(
      true,
    );
  });
});

describe("classifyTerminalTurnApplicability", () => {
  it("accepts a terminal event for the active turn", () => {
    expect(
      classifyTerminalTurnApplicability({
        activeTurnId: "turn-active",
        eventTurnId: "turn-active",
      }),
    ).toEqual({
      applicable: true,
      resolvedTurnId: "turn-active",
      reason: "matches-active-turn",
    });
  });

  it("rejects a terminal event for a different turn without losing its identity", () => {
    expect(
      classifyTerminalTurnApplicability({
        activeTurnId: "turn-current",
        eventTurnId: "turn-stale",
      }),
    ).toEqual({
      applicable: false,
      resolvedTurnId: "turn-stale",
      reason: "conflicts-with-active-turn",
    });
  });

  it("scopes an omitted terminal turn id to the active turn", () => {
    expect(
      classifyTerminalTurnApplicability({
        activeTurnId: "turn-active",
        eventTurnId: undefined,
      }),
    ).toEqual({
      applicable: true,
      resolvedTurnId: "turn-active",
      reason: "implicit-active-turn",
    });
  });

  it("rejects an omitted terminal id when overlapping turns make it ambiguous", () => {
    expect(
      classifyTerminalTurnApplicability({
        activeTurnId: "turn-active",
        eventTurnId: undefined,
        hasAmbiguousTurns: true,
      }),
    ).toEqual({
      applicable: false,
      resolvedTurnId: undefined,
      reason: "ambiguous-missing-turn-id",
    });
  });

  it("accepts scoped and unscoped terminal events when no turn is active", () => {
    expect(
      classifyTerminalTurnApplicability({ activeTurnId: null, eventTurnId: "turn-finished" }),
    ).toEqual({
      applicable: true,
      resolvedTurnId: "turn-finished",
      reason: "no-active-turn",
    });
    expect(
      classifyTerminalTurnApplicability({ activeTurnId: null, eventTurnId: undefined }),
    ).toEqual({
      applicable: true,
      resolvedTurnId: undefined,
      reason: "no-active-turn",
    });
  });
});
