import { type ProviderKind } from "@agent-group/contracts";
import {
  getDefaultModel,
  getModelOptions,
  normalizeModelSlug,
  resolveSelectableModel,
} from "@agent-group/shared/model";

import {
  getCustomModelsByProvider,
  normalizeCustomModelSlugs,
  type CustomModelSettingsKey,
} from "./appCustomModels";
import type { AppSettings } from "./appSettingsSchema";
import { normalizeCursorModelVariantBaseId } from "./cursorModelVariants";
import { formatProviderModelOptionName, type ProviderModelOption } from "./providerModelOptions";

export interface AppModelOption extends ProviderModelOption {
  provider: ProviderKind;
  isCustom: boolean;
}

export function resolveTextGenerationProvider(input: {
  readonly provider?: ProviderKind | null;
  readonly model?: string | null;
}): ProviderKind {
  if (input.provider) return input.provider;
  return input.model?.includes("/") ? "opencode" : "codex";
}

export function getAppModelOptions(
  provider: ProviderKind,
  customModels: readonly string[],
  selectedModel?: string | null,
): AppModelOption[] {
  const options: AppModelOption[] = getModelOptions(provider).map(({ slug, name }) => ({
    provider,
    slug,
    name,
    isCustom: false,
  }));
  const seen = new Set(options.map((option) => option.slug));
  const trimmedSelectedModel = selectedModel?.trim().toLowerCase();

  for (const slug of normalizeCustomModelSlugs(customModels, provider)) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    options.push({
      provider,
      slug,
      name: formatProviderModelOptionName({ provider, slug }),
      isCustom: true,
    });
  }

  const normalizedSelectedModel =
    provider === "cursor"
      ? normalizeCursorModelVariantBaseId(selectedModel)
      : normalizeModelSlug(selectedModel, provider);
  const selectedModelMatchesExistingName =
    typeof trimmedSelectedModel === "string" &&
    options.some((option) => option.name.toLowerCase() === trimmedSelectedModel);
  if (
    normalizedSelectedModel &&
    !seen.has(normalizedSelectedModel) &&
    !selectedModelMatchesExistingName
  ) {
    options.push({
      provider,
      slug: normalizedSelectedModel,
      name: formatProviderModelOptionName({ provider, slug: normalizedSelectedModel }),
      isCustom: true,
    });
  }
  return options;
}

type GitTextGenerationDiscoveredProvider = "codex" | "kilo" | "opencode";

export function mapCatalogModelOptionsToAppModelOptions(
  provider: GitTextGenerationDiscoveredProvider,
  options: ReadonlyArray<ProviderModelOption & { isCustom?: boolean }>,
): AppModelOption[] {
  return options.map((option) => ({
    ...option,
    provider,
    isCustom: option.isCustom ?? false,
  }));
}

export function getGitTextGenerationModelOptions(
  settings: Pick<
    AppSettings,
    | "customCodexModels"
    | "customKiloModels"
    | "customOpenCodeModels"
    | "textGenerationModel"
    | "textGenerationProvider"
  >,
  discoveredOptionsByProvider?: Partial<
    Record<
      GitTextGenerationDiscoveredProvider,
      ReadonlyArray<ProviderModelOption & { isCustom?: boolean }>
    >
  >,
): AppModelOption[] {
  const options = [
    ...(discoveredOptionsByProvider?.codex
      ? mapCatalogModelOptionsToAppModelOptions("codex", discoveredOptionsByProvider.codex)
      : getAppModelOptions("codex", settings.customCodexModels)),
    ...(discoveredOptionsByProvider?.kilo
      ? mapCatalogModelOptionsToAppModelOptions("kilo", discoveredOptionsByProvider.kilo)
      : getAppModelOptions("kilo", settings.customKiloModels)),
    ...(discoveredOptionsByProvider?.opencode
      ? mapCatalogModelOptionsToAppModelOptions("opencode", discoveredOptionsByProvider.opencode)
      : getAppModelOptions("opencode", settings.customOpenCodeModels)),
  ];
  const deduped: AppModelOption[] = [];
  const seen = new Set<string>();

  for (const option of options) {
    const key = `${option.provider}:${option.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(option);
  }

  const selectedModel = settings.textGenerationModel?.trim();
  const selectedProvider =
    settings.textGenerationProvider ??
    resolveTextGenerationProvider(selectedModel !== undefined ? { model: selectedModel } : {});
  if (selectedModel && !seen.has(`${selectedProvider}:${selectedModel}`)) {
    deduped.push({
      provider: selectedProvider,
      slug: selectedModel,
      name: formatProviderModelOptionName({ provider: selectedProvider, slug: selectedModel }),
      isCustom: true,
    });
  }
  return deduped;
}

export function resolveAppModelSelection(
  provider: ProviderKind,
  customModels: Record<ProviderKind, readonly string[]>,
  selectedModel: string | null | undefined,
): string {
  const options = getAppModelOptions(provider, customModels[provider], selectedModel);
  return (
    resolveSelectableModel(provider, selectedModel, options) ?? getDefaultModel(provider) ?? ""
  );
}

export function getCustomModelOptionsByProvider(
  settings: Pick<AppSettings, CustomModelSettingsKey>,
): Record<ProviderKind, ReadonlyArray<ProviderModelOption>> {
  const customModels = getCustomModelsByProvider(settings);
  return {
    codex: getAppModelOptions("codex", customModels.codex),
    claudeAgent: getAppModelOptions("claudeAgent", customModels.claudeAgent),
    cursor: getAppModelOptions("cursor", customModels.cursor),
    antigravity: getAppModelOptions("antigravity", customModels.antigravity),
    grok: getAppModelOptions("grok", customModels.grok),
    droid: getAppModelOptions("droid", customModels.droid),
    kilo: getAppModelOptions("kilo", customModels.kilo),
    opencode: getAppModelOptions("opencode", customModels.opencode),
    pi: getAppModelOptions("pi", customModels.pi),
  };
}
