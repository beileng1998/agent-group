import type { ProviderModelDescriptor } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import { getComposerProviderState } from "./composerProviderRegistry";
import { getRuntimeAwareModelCapabilities } from "./runtimeModelCapabilities";

const KIMI_K3: ProviderModelDescriptor = {
  slug: "kimi-k3",
  name: "Kimi K3",
  supportedReasoningEfforts: [
    { value: "high", label: "High" },
    { value: "max", label: "Max" },
  ],
  defaultReasoningEffort: "high",
  supportsFastMode: true,
  supportsAdaptiveThinking: true,
  autoCompactWindowOptions: [
    { value: "512k", label: "512K", isDefault: true },
    { value: "1m", label: "1M" },
  ],
  contextWindowTokens: 1_000_000,
};

describe("Claude composer runtime capabilities", () => {
  it("uses discovered K3 efforts and context metadata", () => {
    const capabilities = getRuntimeAwareModelCapabilities({
      provider: "claudeAgent",
      model: "kimi-k3",
      runtimeModel: KIMI_K3,
    });

    expect(capabilities.reasoningEffortLevels.map((option) => option.value)).toEqual([
      "high",
      "max",
    ]);
    expect(capabilities.autoCompactWindowOptions).toEqual([
      { value: "512k", label: "512K", isDefault: true },
      { value: "1m", label: "1M" },
    ]);
    expect(capabilities.contextWindowTokens).toBe(1_000_000);
    expect(capabilities.supportsFastMode).toBe(true);
  });

  it("preserves K3 max and 1M when preparing a Claude turn", () => {
    const state = getComposerProviderState({
      provider: "claudeAgent",
      model: "kimi-k3",
      runtimeModel: KIMI_K3,
      prompt: "",
      modelOptions: {
        claudeAgent: {
          effort: "max",
          autoCompactWindow: "1m",
          fastMode: true,
        },
      },
    });

    expect(state).toEqual({
      provider: "claudeAgent",
      promptEffort: "max",
      modelOptionsForDispatch: {
        effort: "max",
        autoCompactWindow: "1m",
        fastMode: true,
      },
    });
  });
});
