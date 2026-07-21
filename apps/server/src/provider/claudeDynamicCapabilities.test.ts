import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";

import { mapSupportedModels } from "./claudeAdapterProtocol.ts";
import { resolveClaudeModelCapabilities } from "./claudeRuntimeModelCapabilities.ts";
import {
  resolveClaudeApiModelIdContextWindowMaxTokens,
  resolveSelectedClaudeAutoCompactWindow,
} from "./claudeTokenUsage.ts";

describe("Claude dynamic model capabilities", () => {
  it("merges SDK aliases and preserves Kimi K3 reasoning and context metadata", () => {
    const models: ModelInfo[] = [
      {
        value: "kimi-k3[1m]",
        resolvedModel: "kimi-k3[1m]",
        displayName: "Kimi K3",
        description: "Kimi K3",
        supportsFastMode: false,
      },
      {
        value: "default",
        resolvedModel: "kimi-k3",
        displayName: "Default",
        description: "Default model",
        supportedEffortLevels: ["high", "max"],
        supportsAdaptiveThinking: true,
        supportsFastMode: true,
      },
    ];

    const result = mapSupportedModels(models);

    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toMatchObject({
      slug: "kimi-k3",
      name: "Kimi K3",
      supportedReasoningEfforts: [
        { value: "high", label: "High" },
        { value: "max", label: "Max" },
      ],
      defaultReasoningEffort: "high",
      supportsAdaptiveThinking: true,
      supportsFastMode: true,
      autoCompactWindowOptions: [
        { value: "512k", label: "512K", isDefault: true },
        { value: "1m", label: "1M" },
      ],
      contextWindowTokens: 1_000_000,
    });
  });

  it("uses runtime capabilities for effort validation and K3 context sizing", () => {
    const descriptor = mapSupportedModels([
      {
        value: "kimi-k3",
        displayName: "Kimi K3",
        description: "Kimi K3",
        supportedEffortLevels: ["high", "max"],
        supportsAdaptiveThinking: true,
      },
    ]).models[0];
    const capabilities = resolveClaudeModelCapabilities("kimi-k3", descriptor);

    expect(capabilities.reasoningEffortLevels.map((option) => option.value)).toEqual([
      "high",
      "max",
    ]);
    expect(resolveSelectedClaudeAutoCompactWindow("kimi-k3", undefined, capabilities)).toBe(
      512_000,
    );
    expect(resolveSelectedClaudeAutoCompactWindow("kimi-k3", "1m", capabilities)).toBe(
      1_000_000,
    );
    expect(resolveClaudeApiModelIdContextWindowMaxTokens("kimi-k3", capabilities)).toBe(
      1_000_000,
    );
  });
});
