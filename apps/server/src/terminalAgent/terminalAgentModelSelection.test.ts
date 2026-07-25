import { describe, expect, it } from "vitest";

import { terminalAgentModelSelectionFromObservation } from "./terminalAgentModelSelection";

describe("terminal agent observed model selection", () => {
  it("preserves Codex options while accepting discovered effort values", () => {
    expect(
      terminalAgentModelSelectionFromObservation(
        {
          provider: "codex",
          model: "gpt-5.2-codex",
          options: { reasoningEffort: "high", fastMode: true },
        },
        { model: "gpt-5.3-codex", effort: "future-effort" },
      ),
    ).toEqual({
      provider: "codex",
      model: "gpt-5.3-codex",
      options: { reasoningEffort: "future-effort", fastMode: true },
    });
  });

  it("accepts only supported Claude effort values and preserves other options", () => {
    const current = {
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      options: {
        thinking: true,
        effort: "high",
        fastMode: true,
        autoCompactWindow: "1m",
      },
    } as const;
    expect(
      terminalAgentModelSelectionFromObservation(current, {
        model: "claude-opus-4-7",
        effort: "unknown",
      }),
    ).toEqual({
      ...current,
      model: "claude-opus-4-7",
    });
    expect(
      terminalAgentModelSelectionFromObservation(current, { effort: "max" }),
    ).toEqual({
      ...current,
      options: { ...current.options, effort: "max" },
    });
  });

  it("accepts only supported Pi thinking levels", () => {
    const current = {
      provider: "pi",
      model: "openai/gpt-5",
      options: { thinkingLevel: "medium" },
    } as const;
    expect(
      terminalAgentModelSelectionFromObservation(current, {
        model: "openai/gpt-5.1",
        effort: "turbo",
      }),
    ).toEqual({
      ...current,
      model: "openai/gpt-5.1",
    });
    expect(
      terminalAgentModelSelectionFromObservation(current, { effort: "xhigh" }),
    ).toEqual({
      ...current,
      options: { thinkingLevel: "xhigh" },
    });
  });
});
