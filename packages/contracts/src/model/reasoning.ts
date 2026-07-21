export const CODEX_REASONING_EFFORT_OPTIONS = ["low", "medium", "high", "xhigh"] as const;
// Codex app-server can add model-specific efforts through runtime discovery.
export type CodexReasoningEffort = string;

export const CLAUDE_API_EFFORT_OPTIONS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ClaudeApiEffort = (typeof CLAUDE_API_EFFORT_OPTIONS)[number];

export const CLAUDE_PROMPT_MODE_OPTIONS = ["ultrathink"] as const;
export type ClaudePromptMode = (typeof CLAUDE_PROMPT_MODE_OPTIONS)[number];

export const CLAUDE_CODE_MODE_OPTIONS = ["ultracode"] as const;
export type ClaudeCodeMode = (typeof CLAUDE_CODE_MODE_OPTIONS)[number];

export const CLAUDE_CODE_EFFORT_OPTIONS = [
  ...CLAUDE_API_EFFORT_OPTIONS,
  ...CLAUDE_PROMPT_MODE_OPTIONS,
  ...CLAUDE_CODE_MODE_OPTIONS,
] as const;
export type ClaudeCodeEffort = (typeof CLAUDE_CODE_EFFORT_OPTIONS)[number];

export const PI_THINKING_LEVEL_OPTIONS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type PiThinkingLevel = (typeof PI_THINKING_LEVEL_OPTIONS)[number];

export const GROK_REASONING_EFFORT_OPTIONS = ["none", "low", "medium", "high"] as const;
export type GrokReasoningEffort = (typeof GROK_REASONING_EFFORT_OPTIONS)[number];

export const DROID_REASONING_EFFORT_OPTIONS = [
  "off",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
// Droid exposes effort values dynamically over ACP; keep the static list only
// as an offline fallback so newly added values survive transport and drafts.
export type DroidReasoningEffort = string;

export type ProviderReasoningEffort =
  | CodexReasoningEffort
  | ClaudeCodeEffort
  | PiThinkingLevel
  | GrokReasoningEffort
  | DroidReasoningEffort;
