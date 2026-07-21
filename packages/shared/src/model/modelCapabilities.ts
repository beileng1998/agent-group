import {
  MODEL_CAPABILITIES_INDEX,
  type ModelCapabilities,
  type ProviderKind,
} from "@agent-group/contracts";
import { normalizeModelSlug, trimOrNull } from "./modelSlugs";

export const EMPTY_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  promptInjectedEffortLevels: [],
  contextWindowOptions: [],
};

/** Check whether a capabilities object includes a given effort value. */
export function hasEffortLevel(caps: ModelCapabilities, value: string): boolean {
  return caps.reasoningEffortLevels.some((level) => level.value === value);
}

/** Return the default effort value for a capabilities object, or null if none. */
export function getDefaultEffort(caps: ModelCapabilities): string | null {
  return caps.reasoningEffortLevels.find((level) => level.isDefault)?.value ?? null;
}

/** Check whether a capabilities object includes a given context window value. */
export function hasContextWindowOption(caps: ModelCapabilities, value: string): boolean {
  return caps.contextWindowOptions.some((option) => option.value === value);
}

/** Return the default context window value for a capabilities object, or null if none. */
export function getDefaultContextWindow(caps: ModelCapabilities): string | null {
  return caps.contextWindowOptions.find((option) => option.isDefault)?.value ?? null;
}

/** Check whether a Claude auto-compaction budget is supported. */
export function hasAutoCompactWindowOption(caps: ModelCapabilities, value: string): boolean {
  return caps.autoCompactWindowOptions?.some((option) => option.value === value) ?? false;
}

/** Return the default Claude auto-compaction budget, or null if the model has no override. */
export function getDefaultAutoCompactWindow(caps: ModelCapabilities): string | null {
  return caps.autoCompactWindowOptions?.find((option) => option.isDefault)?.value ?? null;
}

export function resolveLabeledOptionValue(
  options: ReadonlyArray<{ value: string; isDefault?: boolean | undefined }> | undefined,
  rawValue: string | null | undefined,
): string | null {
  const trimmedValue = trimOrNull(rawValue);
  if (!options || options.length === 0) {
    return trimmedValue;
  }
  if (trimmedValue && options.some((option) => option.value === trimmedValue)) {
    return trimmedValue;
  }
  return options.find((option) => option.isDefault)?.value ?? options[0]?.value ?? null;
}

export function getModelCapabilities(
  provider: ProviderKind,
  model: string | null | undefined,
): ModelCapabilities {
  const slug = normalizeModelSlug(model, provider);
  if (slug && MODEL_CAPABILITIES_INDEX[provider]?.[slug]) {
    return MODEL_CAPABILITIES_INDEX[provider][slug];
  }
  if (provider === "grok" && slug) {
    // Grok exposes reasoning effort as a provider-level CLI option, while its
    // runtime model catalog contains only model ids. New models must inherit the
    // provider ladder even before runtime discovery has returned their descriptor.
    return MODEL_CAPABILITIES_INDEX.grok["grok-build"] ?? EMPTY_MODEL_CAPABILITIES;
  }
  return EMPTY_MODEL_CAPABILITIES;
}
