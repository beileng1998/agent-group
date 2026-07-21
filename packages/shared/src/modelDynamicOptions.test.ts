import { describe, expect, it } from "vitest";

import { claudeSelectionRequiresRestart } from "./model/claudeSelection";
import { normalizePiModelOptions } from "./model/modelOptions";

describe("dynamic provider model options", () => {
  it("preserves Pi max thinking", () => {
    expect(normalizePiModelOptions({ thinkingLevel: "max" })).toEqual({ thinkingLevel: "max" });
  });

  it("restarts Claude when a dynamic model's spawn-time effort changes", () => {
    expect(
      claudeSelectionRequiresRestart(
        {
          provider: "claudeAgent",
          model: "kimi-k3",
          options: { effort: "high" },
        },
        {
          provider: "claudeAgent",
          model: "kimi-k3",
          options: { effort: "max" },
        },
      ),
    ).toBe(true);
  });
});
