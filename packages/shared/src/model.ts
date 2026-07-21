export {
  formatModelDisplayName,
  getDefaultModel,
  getModelOptions,
  humanizeModelSlug,
  normalizeModelSlug,
  resolveModelSlug,
  resolveModelSlugForProvider,
  resolveSelectableModel,
  trimOrNull,
  type SelectableModelOption,
} from "./model/modelSlugs";

export {
  EMPTY_MODEL_CAPABILITIES,
  getDefaultAutoCompactWindow,
  getDefaultContextWindow,
  getDefaultEffort,
  getModelCapabilities,
  hasAutoCompactWindowOption,
  hasContextWindowOption,
  hasEffortLevel,
  resolveLabeledOptionValue,
} from "./model/modelCapabilities";

export {
  buildProviderOptionSelectionsFromDescriptors,
  getModelSelectionBooleanOptionValue,
  getModelSelectionOptionValue,
  getModelSelectionStringOptionValue,
  getProviderOptionBooleanSelectionValue,
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  getProviderOptionSelectionValue,
  getProviderOptionStringSelectionValue,
} from "./model/providerOptions";

export {
  normalizeAntigravityModelOptions,
  normalizeClaudeModelOptions,
  normalizeCodexModelOptions,
  normalizeCursorModelOptions,
  normalizeDroidModelOptions,
  normalizeGrokModelOptions,
  normalizeOpenCodeModelOptions,
  normalizePiModelOptions,
} from "./model/modelOptions";

export {
  applyClaudePromptEffortPrefix,
  claudeSelectionRequiresRestart,
  getEffectiveClaudeCodeEffort,
  isClaudeUltrathinkPrompt,
  resolveApiModelId,
} from "./model/claudeSelection";
