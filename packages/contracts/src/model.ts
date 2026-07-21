import type { ProviderKind } from "./providerKind";
import type { ModelCapabilities } from "./model/capabilities";
import { MODEL_OPTIONS_BY_PROVIDER } from "./model/catalog";

export * from "./model/providerOptions";
export * from "./model/reasoning";
export type {
  ContextWindowOption,
  EffortOption,
  ModelCapabilities,
  ReasoningControlSource,
} from "./model/capabilities";
export {
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  MODEL_OPTIONS,
  MODEL_OPTIONS_BY_PROVIDER,
} from "./model/catalog";
export type { ModelOptionsByProvider, ModelSlug, ProviderWithDefaultModel } from "./model/catalog";
export { MODEL_SLUG_ALIASES_BY_PROVIDER } from "./model/modelAliases";

// Agent mention aliases remain available from the historical model entry point.
export {
  AGENT_MENTION_ALIASES,
  getAgentMentionAutocompleteAliases,
  getAgentMentionAliases,
  resolveAgentAlias,
  isValidAgentAlias,
  getAgentAliasNames,
  type AgentAliasDefinition,
  type ResolvedAgentAlias,
} from "./agentMentions";

export const MODEL_CAPABILITIES_INDEX = Object.fromEntries(
  Object.entries(MODEL_OPTIONS_BY_PROVIDER).map(([provider, models]) => [
    provider,
    Object.fromEntries(models.map((model) => [model.slug, model.capabilities])),
  ]),
) as unknown as Record<ProviderKind, Record<string, ModelCapabilities>>;

export const PROVIDER_DISPLAY_NAMES: Record<ProviderKind, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
  cursor: "Cursor",
  antigravity: "Antigravity",
  grok: "Grok",
  droid: "Droid",
  kilo: "Kilo",
  opencode: "OpenCode",
  pi: "Pi",
};
