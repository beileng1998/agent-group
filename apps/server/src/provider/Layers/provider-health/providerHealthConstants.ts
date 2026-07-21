import type { ProviderKind, ServerProviderStatus } from "@agent-group/contracts";

export const DEFAULT_TIMEOUT_MS = 4_000;
export const CLAUDE_HEALTH_TIMEOUT_MS = 20_000;
export const OPENCODE_HEALTH_TIMEOUT_MS = 20_000;

export const CODEX_PROVIDER = "codex" as const;
export const CLAUDE_AGENT_PROVIDER = "claudeAgent" as const;
export const CURSOR_PROVIDER = "cursor" as const;
export const ANTIGRAVITY_PROVIDER = "antigravity" as const;
export const GROK_PROVIDER = "grok" as const;
export const DROID_PROVIDER = "droid" as const;
export const KILO_PROVIDER = "kilo" as const;
export const OPENCODE_PROVIDER = "opencode" as const;
export const PI_PROVIDER = "pi" as const;

export type ProviderStatuses = ReadonlyArray<ServerProviderStatus>;

export const DISABLED_PROVIDER_STATUS_MESSAGE = "Provider is disabled in Agent Group settings.";
export const MINIMUM_ANTIGRAVITY_CLI_VERSION = "1.0.12";

export const PROVIDERS = [
  CODEX_PROVIDER,
  CLAUDE_AGENT_PROVIDER,
  CURSOR_PROVIDER,
  ANTIGRAVITY_PROVIDER,
  GROK_PROVIDER,
  DROID_PROVIDER,
  KILO_PROVIDER,
  OPENCODE_PROVIDER,
  PI_PROVIDER,
] as const satisfies ReadonlyArray<ProviderKind>;

export const UPDATE_OUTPUT_MAX_BYTES = 10_000;
export const PROVIDER_UPDATE_TIMEOUT_MS = 2 * 60_000;
