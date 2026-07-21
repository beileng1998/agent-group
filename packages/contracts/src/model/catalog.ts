import type { ProviderKind } from "../providerKind";
import {
  CLAUDE_EXTENDED_THINKING_CAPABILITIES,
  CLAUDE_FABLE_CAPABILITIES,
  CLAUDE_FLAGSHIP_CAPABILITIES,
  CLAUDE_SONNET_5_CAPABILITIES,
  CODEX_GPT_5_5_CAPABILITIES,
  CODEX_GPT_5_CAPABILITIES,
  GROK_BUILD_CAPABILITIES,
  type ModelCapabilities,
} from "./capabilities";
import {
  DROID_CLAUDE_BASIC_CAPABILITIES,
  DROID_CLAUDE_MAX_CAPABILITIES,
  DROID_CLAUDE_XHIGH_CAPABILITIES,
  DROID_CORE_DEEPSEEK_CAPABILITIES,
  DROID_CORE_HIGH_CAPABILITIES,
  DROID_CORE_HIGH_ONLY_CAPABILITIES,
  DROID_GEMINI_HIGH_CAPABILITIES,
  DROID_GEMINI_MINIMAL_CAPABILITIES,
  DROID_GPT_5_2_CAPABILITIES,
  DROID_GPT_5_6_CAPABILITIES,
  DROID_GPT_HIGH_CAPABILITIES,
  DROID_GPT_MEDIUM_CAPABILITIES,
  DROID_GPT_PRO_CAPABILITIES,
  droidCapabilities,
} from "./droidCapabilities";

type ModelDefinition = {
  readonly slug: string;
  readonly name: string;
  readonly capabilities: ModelCapabilities;
};

/**
 * TODO: This should not be a static array, each provider
 * should return its own model list over the WS API.
 */
export const MODEL_OPTIONS_BY_PROVIDER = {
  codex: [
    {
      slug: "gpt-5.5",
      name: "GPT-5.5",
      capabilities: CODEX_GPT_5_5_CAPABILITIES,
    },
    {
      slug: "gpt-5.4",
      name: "GPT-5.4",
      capabilities: CODEX_GPT_5_CAPABILITIES,
    },
    {
      slug: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      capabilities: CODEX_GPT_5_CAPABILITIES,
    },
    {
      slug: "gpt-5.3-codex",
      name: "GPT-5.3 Codex",
      capabilities: CODEX_GPT_5_CAPABILITIES,
    },
    {
      slug: "gpt-5.3-codex-spark",
      name: "GPT-5.3 Codex Spark",
      capabilities: CODEX_GPT_5_CAPABILITIES,
    },
    {
      slug: "gpt-5.2-codex",
      name: "GPT-5.2 Codex",
      capabilities: CODEX_GPT_5_CAPABILITIES,
    },
    {
      slug: "gpt-5.2",
      name: "GPT-5.2",
      capabilities: CODEX_GPT_5_CAPABILITIES,
    },
  ],
  claudeAgent: [
    {
      slug: "claude-fable-5",
      name: "Claude Fable 5",
      capabilities: CLAUDE_FABLE_CAPABILITIES,
    },
    {
      slug: "claude-opus-4-8",
      name: "Claude Opus 4.8",
      capabilities: CLAUDE_FLAGSHIP_CAPABILITIES,
    },
    {
      slug: "claude-opus-4-7",
      name: "Claude Opus 4.7",
      capabilities: CLAUDE_FLAGSHIP_CAPABILITIES,
    },
    {
      slug: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      capabilities: CLAUDE_EXTENDED_THINKING_CAPABILITIES,
    },
    {
      slug: "claude-opus-4-5",
      name: "Claude Opus 4.5",
      capabilities: {
        reasoningEffortLevels: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High", isDefault: true },
        ],
        supportsFastMode: false,
        supportsThinkingToggle: false,
        promptInjectedEffortLevels: [],
        contextWindowOptions: [],
        contextWindowTokens: 200_000,
      },
    },
    {
      slug: "claude-sonnet-5",
      name: "Claude Sonnet 5",
      capabilities: CLAUDE_SONNET_5_CAPABILITIES,
    },
    {
      slug: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      capabilities: { ...CLAUDE_EXTENDED_THINKING_CAPABILITIES, supportsFastMode: false },
    },
    {
      slug: "claude-haiku-4-5",
      name: "Claude Haiku 4.5",
      capabilities: {
        reasoningEffortLevels: [],
        supportsFastMode: false,
        supportsThinkingToggle: true,
        promptInjectedEffortLevels: [],
        contextWindowOptions: [],
        contextWindowTokens: 200_000,
      },
    },
  ],
  // Antigravity owns its model catalog. The web app populates this provider from
  // `agy models` so CLI updates appear without a Agent Group release.
  antigravity: [],
  grok: [
    {
      slug: "grok-build-0.1",
      name: "Grok Build 0.1",
      capabilities: GROK_BUILD_CAPABILITIES,
    },
    {
      slug: "grok-build",
      name: "Grok 4.3",
      capabilities: GROK_BUILD_CAPABILITIES,
    },
  ],
  droid: [
    {
      // Factory routes to a model automatically at its lowest (1x) token rate.
      // Reasoning effort follows the routed model's default, so no picker.
      slug: "auto",
      name: "Auto Model",
      capabilities: droidCapabilities([]),
    },
    {
      slug: "claude-fable-5",
      name: "Claude Fable 5",
      capabilities: DROID_CLAUDE_XHIGH_CAPABILITIES,
    },
    {
      slug: "claude-opus-4-8",
      name: "Claude Opus 4.8",
      capabilities: DROID_CLAUDE_XHIGH_CAPABILITIES,
    },
    {
      slug: "claude-opus-4-8-fast",
      name: "Claude Opus 4.8 Fast",
      capabilities: DROID_CLAUDE_XHIGH_CAPABILITIES,
    },
    {
      slug: "claude-opus-4-7",
      name: "Claude Opus 4.7",
      capabilities: DROID_CLAUDE_MAX_CAPABILITIES,
    },
    {
      slug: "claude-opus-4-7-fast",
      name: "Claude Opus 4.7 Fast",
      capabilities: DROID_CLAUDE_MAX_CAPABILITIES,
    },
    {
      slug: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      capabilities: DROID_CLAUDE_MAX_CAPABILITIES,
    },
    {
      slug: "claude-sonnet-5",
      name: "Claude Sonnet 5",
      capabilities: DROID_CLAUDE_XHIGH_CAPABILITIES,
    },
    {
      slug: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      capabilities: DROID_CLAUDE_MAX_CAPABILITIES,
    },
    {
      slug: "claude-opus-4-5-20251101",
      name: "Claude Opus 4.5",
      capabilities: DROID_CLAUDE_BASIC_CAPABILITIES,
    },
    {
      slug: "claude-sonnet-4-5-20250929",
      name: "Claude Sonnet 4.5",
      capabilities: DROID_CLAUDE_BASIC_CAPABILITIES,
    },
    {
      slug: "claude-haiku-4-5-20251001",
      name: "Claude Haiku 4.5",
      capabilities: DROID_CLAUDE_BASIC_CAPABILITIES,
    },
    {
      slug: "gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      capabilities: DROID_GPT_5_6_CAPABILITIES,
    },
    {
      slug: "gpt-5.6-terra",
      name: "GPT-5.6 Terra",
      capabilities: DROID_GPT_5_6_CAPABILITIES,
    },
    {
      slug: "gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      capabilities: DROID_GPT_5_6_CAPABILITIES,
    },
    {
      slug: "gpt-5.5",
      name: "GPT-5.5",
      capabilities: DROID_GPT_MEDIUM_CAPABILITIES,
    },
    {
      slug: "gpt-5.5-fast",
      name: "GPT-5.5 Fast",
      capabilities: DROID_GPT_MEDIUM_CAPABILITIES,
    },
    {
      slug: "gpt-5.5-pro",
      name: "GPT-5.5 Pro",
      capabilities: DROID_GPT_PRO_CAPABILITIES,
    },
    {
      slug: "gpt-5.4",
      name: "GPT-5.4",
      capabilities: DROID_GPT_MEDIUM_CAPABILITIES,
    },
    {
      slug: "gpt-5.4-fast",
      name: "GPT-5.4 Fast",
      capabilities: DROID_GPT_MEDIUM_CAPABILITIES,
    },
    {
      slug: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      capabilities: DROID_GPT_HIGH_CAPABILITIES,
    },
    {
      slug: "gpt-5.3-codex",
      name: "GPT-5.3 Codex",
      capabilities: DROID_GPT_MEDIUM_CAPABILITIES,
    },
    {
      slug: "gpt-5.3-codex-fast",
      name: "GPT-5.3 Codex Fast",
      capabilities: DROID_GPT_MEDIUM_CAPABILITIES,
    },
    {
      slug: "gpt-5.2",
      name: "GPT-5.2",
      capabilities: DROID_GPT_5_2_CAPABILITIES,
    },
    {
      slug: "gemini-3.1-pro-preview",
      name: "Gemini 3.1 Pro",
      capabilities: DROID_GEMINI_HIGH_CAPABILITIES,
    },
    {
      slug: "gemini-3.5-flash",
      name: "Gemini 3.5 Flash",
      capabilities: DROID_GEMINI_MINIMAL_CAPABILITIES,
    },
    {
      slug: "gemini-3-flash-preview",
      name: "Gemini 3 Flash",
      capabilities: DROID_GEMINI_MINIMAL_CAPABILITIES,
    },
    {
      slug: "glm-5.2",
      name: "GLM-5.2",
      capabilities: DROID_CORE_HIGH_CAPABILITIES,
    },
    {
      slug: "glm-5.2-fast",
      name: "GLM-5.2 Fast",
      capabilities: DROID_CORE_HIGH_CAPABILITIES,
    },
    {
      slug: "glm-5.1",
      name: "GLM-5.1",
      capabilities: DROID_CORE_HIGH_CAPABILITIES,
    },
    {
      slug: "nemotron-3-ultra",
      name: "Nemotron 3 Ultra",
      capabilities: DROID_CORE_HIGH_CAPABILITIES,
    },
    {
      slug: "kimi-k2.7-code",
      name: "Kimi K2.7 Code",
      capabilities: DROID_CORE_HIGH_CAPABILITIES,
    },
    {
      slug: "kimi-k2.6",
      name: "Kimi K2.6",
      capabilities: DROID_CORE_HIGH_CAPABILITIES,
    },
    {
      slug: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      capabilities: DROID_CORE_DEEPSEEK_CAPABILITIES,
    },
    {
      slug: "minimax-m3",
      name: "MiniMax M3",
      capabilities: DROID_CORE_HIGH_ONLY_CAPABILITIES,
    },
    {
      slug: "minimax-m2.7",
      name: "MiniMax M2.7",
      capabilities: DROID_CORE_HIGH_ONLY_CAPABILITIES,
    },
  ],
  opencode: [
    {
      slug: "openai/gpt-5",
      name: "OpenAI GPT-5",
      capabilities: {
        reasoningEffortLevels: [],
        supportsFastMode: false,
        supportsThinkingToggle: false,
        promptInjectedEffortLevels: [],
        contextWindowOptions: [],
      },
    },
  ],
  kilo: [
    {
      slug: "kilo/kilo-auto/free",
      name: "Kilo Auto Free",
      capabilities: {
        reasoningEffortLevels: [],
        supportsFastMode: false,
        supportsThinkingToggle: false,
        promptInjectedEffortLevels: [],
        contextWindowOptions: [],
      },
    },
  ],
  pi: [],
  cursor: [
    {
      slug: "auto",
      name: "Auto",
      capabilities: {
        reasoningEffortLevels: [],
        supportsFastMode: false,
        supportsThinkingToggle: false,
        promptInjectedEffortLevels: [],
        contextWindowOptions: [],
      },
    },
    {
      slug: "composer-2",
      name: "Composer 2",
      capabilities: {
        reasoningEffortLevels: [],
        supportsFastMode: false,
        supportsThinkingToggle: false,
        promptInjectedEffortLevels: [],
        contextWindowOptions: [],
      },
    },
    {
      slug: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      capabilities: {
        reasoningEffortLevels: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High", isDefault: true },
          { value: "max", label: "Max" },
        ],
        supportsFastMode: false,
        supportsThinkingToggle: false,
        promptInjectedEffortLevels: [],
        contextWindowOptions: [],
      },
    },
    {
      slug: "gpt-5.3-codex",
      name: "GPT-5.3 Codex",
      capabilities: CODEX_GPT_5_CAPABILITIES,
    },
    {
      slug: "gemini-3-pro",
      name: "Gemini 3 Pro",
      capabilities: {
        reasoningEffortLevels: [],
        supportsFastMode: false,
        supportsThinkingToggle: false,
        promptInjectedEffortLevels: [],
        contextWindowOptions: [],
      },
    },
  ],
} as const satisfies Record<ProviderKind, readonly ModelDefinition[]>;
export type ModelOptionsByProvider = typeof MODEL_OPTIONS_BY_PROVIDER;

type BuiltInModelSlug = (typeof MODEL_OPTIONS_BY_PROVIDER)[ProviderKind][number]["slug"];
export type ModelSlug = BuiltInModelSlug | (string & {});

export type ProviderWithDefaultModel = Exclude<ProviderKind, "pi">;

export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderWithDefaultModel, ModelSlug> = {
  codex: "gpt-5.5",
  claudeAgent: "claude-sonnet-5",
  cursor: "auto",
  antigravity: "Gemini 3.5 Flash",
  grok: "grok-build",
  droid: "claude-opus-4-8",
  kilo: "kilo/kilo-auto/free",
  opencode: "openai/gpt-5",
};

// Backward compatibility for existing Codex-only call sites.
export const MODEL_OPTIONS = MODEL_OPTIONS_BY_PROVIDER.codex;
export const DEFAULT_MODEL = DEFAULT_MODEL_BY_PROVIDER.codex;
export const DEFAULT_GIT_TEXT_GENERATION_MODEL = "gpt-5.4-mini" as const;
