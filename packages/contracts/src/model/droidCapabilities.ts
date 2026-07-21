import type { EffortOption, ModelCapabilities } from "./capabilities";

export function droidCapabilities(
  reasoningEffortLevels: readonly EffortOption[],
): ModelCapabilities {
  return {
    reasoningEffortLevels,
    supportsFastMode: false,
    supportsThinkingToggle: false,
    promptInjectedEffortLevels: [],
    contextWindowOptions: [],
  };
}

export const DROID_CLAUDE_XHIGH_CAPABILITIES = droidCapabilities([
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High", isDefault: true },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
]);

export const DROID_CLAUDE_MAX_CAPABILITIES = droidCapabilities([
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High", isDefault: true },
  { value: "max", label: "Max" },
]);

export const DROID_CLAUDE_BASIC_CAPABILITIES = droidCapabilities([
  { value: "off", label: "Off", isDefault: true },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
]);

export const DROID_GPT_MEDIUM_CAPABILITIES = droidCapabilities([
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium", isDefault: true },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
]);

export const DROID_GPT_5_6_CAPABILITIES = droidCapabilities([
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium", isDefault: true },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Maximum" },
]);

export const DROID_GPT_PRO_CAPABILITIES = droidCapabilities([
  { value: "medium", label: "Medium", isDefault: true },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
]);

export const DROID_GPT_HIGH_CAPABILITIES = droidCapabilities([
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High", isDefault: true },
  { value: "xhigh", label: "Extra High" },
]);

export const DROID_GPT_5_2_CAPABILITIES = droidCapabilities([
  { value: "off", label: "Off" },
  { value: "low", label: "Low", isDefault: true },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
]);

export const DROID_GEMINI_HIGH_CAPABILITIES = droidCapabilities([
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High", isDefault: true },
]);

export const DROID_GEMINI_MINIMAL_CAPABILITIES = droidCapabilities([
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High", isDefault: true },
]);

export const DROID_CORE_HIGH_CAPABILITIES = droidCapabilities([
  { value: "off", label: "Off" },
  { value: "high", label: "High", isDefault: true },
]);

export const DROID_CORE_DEEPSEEK_CAPABILITIES = droidCapabilities([
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "high", label: "High", isDefault: true },
  { value: "max", label: "Max" },
]);

export const DROID_CORE_HIGH_ONLY_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [{ value: "high", label: "High", isDefault: true }],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  promptInjectedEffortLevels: [],
  contextWindowOptions: [],
};
