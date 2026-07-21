import type { ProviderOptionDescriptor } from "./providerOptions";
import type { ClaudeApiEffort, ClaudeCodeMode, ClaudePromptMode } from "./reasoning";

export type ReasoningControlSource = "api-effort" | "provider-setting" | "prompt-prefix";

type EffortOptionBase = {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly isDefault?: true;
};

export type EffortOption =
  | (EffortOptionBase & {
      readonly controlSource?: "api-effort";
      readonly apiEffortValue?: never;
    })
  | (EffortOptionBase & {
      readonly controlSource: "provider-setting";
      readonly apiEffortValue: string;
    })
  | (EffortOptionBase & {
      readonly controlSource: "prompt-prefix";
      readonly apiEffortValue?: never;
    });

export type ContextWindowOption = {
  readonly value: string;
  readonly label: string;
  readonly isDefault?: true;
};

export type ModelCapabilities = {
  readonly optionDescriptors?: readonly ProviderOptionDescriptor[];
  readonly reasoningEffortLevels: readonly EffortOption[];
  readonly supportsFastMode: boolean;
  readonly supportsThinkingToggle: boolean;
  readonly promptInjectedEffortLevels: readonly string[];
  readonly contextWindowOptions: readonly ContextWindowOption[];
  readonly autoCompactWindowOptions?: readonly ContextWindowOption[];
  readonly contextWindowTokens?: number;
  readonly variantOptions?: readonly EffortOption[];
  readonly agentOptions?: readonly EffortOption[];
};

export const CODEX_GPT_5_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High", isDefault: true },
    { value: "xhigh", label: "Extra High" },
  ],
  supportsFastMode: true,
  supportsThinkingToggle: false,
  promptInjectedEffortLevels: [],
  contextWindowOptions: [],
};

export const CODEX_GPT_5_5_CAPABILITIES: ModelCapabilities = {
  ...CODEX_GPT_5_CAPABILITIES,
  reasoningEffortLevels: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium", isDefault: true },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra High" },
  ],
};

export const GROK_BUILD_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: "none", label: "None" },
    { value: "low", label: "Low", isDefault: true },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  promptInjectedEffortLevels: [],
  contextWindowOptions: [],
};

// Shared Claude building blocks. Capability shapes repeat across Claude
// generations, so declare them once and let each model entry override only the
// fields that genuinely differ (mirrors the CODEX_GPT_5_* pattern above).
const CLAUDE_AUTO_COMPACT_WINDOWS: readonly ContextWindowOption[] = [
  { value: "200k", label: "200k", isDefault: true },
  { value: "1m", label: "1M (model default)" },
];

function claudeApiEffortOption(
  value: ClaudeApiEffort,
  label: string,
  options: Pick<EffortOption, "isDefault"> = {},
): EffortOption {
  return { value, label, controlSource: "api-effort", ...options };
}

function claudePromptModeOption(value: ClaudePromptMode, label: string): EffortOption {
  return { value, label, controlSource: "prompt-prefix" };
}

function claudeCodeModeOption(
  value: ClaudeCodeMode,
  label: string,
  apiEffortValue: ClaudeApiEffort,
  description: string,
): EffortOption {
  return { value, label, description, apiEffortValue, controlSource: "provider-setting" };
}

// No-fast xhigh ladder: newer Claude Code models with xhigh/max API efforts and
// the ultracode mode setting, but no ultrathink prompt mode or fast mode.
export const CLAUDE_NO_FAST_XHIGH_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [
    claudeApiEffortOption("low", "Low"),
    claudeApiEffortOption("medium", "Medium"),
    claudeApiEffortOption("high", "High", { isDefault: true }),
    claudeApiEffortOption("xhigh", "Extra High"),
    claudeApiEffortOption("max", "Max"),
    claudeCodeModeOption("ultracode", "Ultracode", "xhigh", "xhigh + workflows"),
  ],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  promptInjectedEffortLevels: [],
  contextWindowOptions: [],
  autoCompactWindowOptions: CLAUDE_AUTO_COMPACT_WINDOWS,
  contextWindowTokens: 1_000_000,
};

export const CLAUDE_FABLE_CAPABILITIES: ModelCapabilities = CLAUDE_NO_FAST_XHIGH_CAPABILITIES;

// Full reasoning ladder: xhigh + ultracode + ultrathink (Opus 4.7/4.8).
export const CLAUDE_FLAGSHIP_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [
    claudeApiEffortOption("low", "Low"),
    claudeApiEffortOption("medium", "Medium"),
    claudeApiEffortOption("high", "High", { isDefault: true }),
    claudeApiEffortOption("xhigh", "Extra High"),
    claudeApiEffortOption("max", "Max"),
    claudePromptModeOption("ultrathink", "Ultrathink"),
    claudeCodeModeOption("ultracode", "Ultracode", "xhigh", "xhigh + workflows"),
  ],
  supportsFastMode: true,
  supportsThinkingToggle: false,
  promptInjectedEffortLevels: ["ultrathink"],
  contextWindowOptions: [],
  autoCompactWindowOptions: CLAUDE_AUTO_COMPACT_WINDOWS,
  contextWindowTokens: 1_000_000,
};

// Reasoning ladder before xhigh/ultracode landed (Opus 4.6, Sonnet 4.6).
export const CLAUDE_EXTENDED_THINKING_CAPABILITIES: ModelCapabilities = {
  ...CLAUDE_FLAGSHIP_CAPABILITIES,
  reasoningEffortLevels: [
    claudeApiEffortOption("low", "Low"),
    claudeApiEffortOption("medium", "Medium"),
    claudeApiEffortOption("high", "High", { isDefault: true }),
    claudeApiEffortOption("max", "Max"),
    claudePromptModeOption("ultrathink", "Ultrathink"),
  ],
};

// Sonnet 5 adds xhigh for long agentic work, while staying in the Sonnet no-fast-mode lane.
export const CLAUDE_SONNET_5_CAPABILITIES: ModelCapabilities = CLAUDE_NO_FAST_XHIGH_CAPABILITIES;
