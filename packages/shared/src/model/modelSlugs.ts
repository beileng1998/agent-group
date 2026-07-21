import {
  DEFAULT_MODEL_BY_PROVIDER,
  MODEL_OPTIONS_BY_PROVIDER,
  MODEL_SLUG_ALIASES_BY_PROVIDER,
  type ModelSlug,
  type ProviderKind,
  type ProviderWithDefaultModel,
} from "@agent-group/contracts";

const MODEL_SLUG_SET_BY_PROVIDER: Record<ProviderKind, ReadonlySet<ModelSlug>> = {
  claudeAgent: new Set(MODEL_OPTIONS_BY_PROVIDER.claudeAgent.map((option) => option.slug)),
  codex: new Set(MODEL_OPTIONS_BY_PROVIDER.codex.map((option) => option.slug)),
  cursor: new Set(MODEL_OPTIONS_BY_PROVIDER.cursor.map((option) => option.slug)),
  // Antigravity's built-in list is intentionally empty; its CLI supplies the live catalog.
  antigravity: new Set<ModelSlug>(),
  grok: new Set(MODEL_OPTIONS_BY_PROVIDER.grok.map((option) => option.slug)),
  droid: new Set(MODEL_OPTIONS_BY_PROVIDER.droid.map((option) => option.slug)),
  kilo: new Set(MODEL_OPTIONS_BY_PROVIDER.kilo.map((option) => option.slug)),
  opencode: new Set(MODEL_OPTIONS_BY_PROVIDER.opencode.map((option) => option.slug)),
  pi: new Set<ModelSlug>(),
};

const MODEL_NAME_BY_SLUG = new Map(
  Object.values(MODEL_OPTIONS_BY_PROVIDER)
    .flat()
    .map((option) => [option.slug.toLowerCase(), option.name] as const),
);

export interface SelectableModelOption {
  slug: string;
  name: string;
}

export function getModelOptions(provider: ProviderKind = "codex") {
  return MODEL_OPTIONS_BY_PROVIDER[provider];
}

function hasDefaultModel(provider: ProviderKind): provider is ProviderWithDefaultModel {
  return provider !== "pi";
}

export function getDefaultModel(provider: "pi"): null;
export function getDefaultModel(provider?: ProviderWithDefaultModel): ModelSlug;
export function getDefaultModel(provider: ProviderKind): ModelSlug | null;
export function getDefaultModel(provider: ProviderKind = "codex"): ModelSlug | null {
  return hasDefaultModel(provider) ? DEFAULT_MODEL_BY_PROVIDER[provider] : null;
}

// Turns a raw model slug into a readable label when no built-in name exists.
// GPT slugs keep their canonical "GPT-x" casing; provider-scoped custom ids
// ("vendor/model") stay verbatim; everything else is title-cased on -/_ .
export function humanizeModelSlug(slug: string): string {
  if (slug.toLowerCase().startsWith("gpt-")) {
    const [, version, ...rest] = slug.split("-");
    if (rest.length === 0) return `GPT-${version}`;
    return `GPT-${version} ${rest.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ")}`;
  }
  if (slug.includes("/")) {
    return slug;
  }
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatModelDisplayName(model: string | null | undefined): string | undefined {
  const normalized = trimOrNull(model);
  if (!normalized) {
    return undefined;
  }

  return MODEL_NAME_BY_SLUG.get(normalized.toLowerCase()) ?? humanizeModelSlug(normalized);
}

export function normalizeModelSlug(
  model: string | null | undefined,
  provider: ProviderKind = "codex",
): ModelSlug | null {
  if (typeof model !== "string") {
    return null;
  }

  const trimmed = model.trim();
  if (!trimmed) {
    return null;
  }

  const providerScopedModel =
    provider === "claudeAgent" ? trimmed.replace(/\[[^\]]+\]$/u, "") : trimmed;
  const aliases = MODEL_SLUG_ALIASES_BY_PROVIDER[provider] as Record<string, ModelSlug>;
  const aliased = Object.prototype.hasOwnProperty.call(aliases, providerScopedModel)
    ? aliases[providerScopedModel]
    : undefined;
  return typeof aliased === "string" ? aliased : (providerScopedModel as ModelSlug);
}

export function resolveSelectableModel(
  provider: ProviderKind,
  value: string | null | undefined,
  options: ReadonlyArray<SelectableModelOption>,
): ModelSlug | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const direct = options.find((option) => option.slug === trimmed);
  if (direct) {
    return direct.slug;
  }

  const byName = options.find((option) => option.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) {
    return byName.slug;
  }

  const normalized = normalizeModelSlug(trimmed, provider);
  if (!normalized) {
    return null;
  }

  const resolved = options.find((option) => option.slug === normalized);
  return resolved ? resolved.slug : null;
}

export function resolveModelSlug(
  model: string | null | undefined,
  provider: ProviderKind = "codex",
): ModelSlug | null {
  const normalized = normalizeModelSlug(model, provider);
  if (provider === "pi") {
    return normalized;
  }
  if (!normalized) {
    return DEFAULT_MODEL_BY_PROVIDER[provider];
  }

  return MODEL_SLUG_SET_BY_PROVIDER[provider].has(normalized)
    ? normalized
    : DEFAULT_MODEL_BY_PROVIDER[provider];
}

export function resolveModelSlugForProvider(
  provider: ProviderKind,
  model: string | null | undefined,
): ModelSlug | null {
  return resolveModelSlug(model, provider);
}

/** Trim a string, returning null for empty/missing values. */
export function trimOrNull<T extends string>(value: T | null | undefined): T | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim() as T;
  return trimmed || null;
}
