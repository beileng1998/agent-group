import { formatModelDisplayName } from "@agent-group/shared/model";
import type * as EffectAcpSchema from "effect-acp/schema";

export interface CursorAcpModelChoice {
  readonly slug: string;
  readonly name: string;
  readonly upstreamProviderId?: string;
  readonly upstreamProviderName?: string;
}

export interface CursorAcpSelectOption {
  readonly value: string;
  readonly name: string;
  readonly groupId?: string;
  readonly groupName?: string;
}

export function resolveCursorAcpBaseModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  if (!trimmed || trimmed === "auto") return "auto";
  const parameterStart = trimmed.indexOf("[");
  return parameterStart === -1 ? trimmed : trimmed.slice(0, parameterStart).trim() || "auto";
}

export function normalizedCursorText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

export function flattenCursorSessionConfigSelectOptions(
  configOption: EffectAcpSchema.SessionConfigOption | undefined,
): ReadonlyArray<CursorAcpSelectOption> {
  if (!configOption || configOption.type !== "select") {
    return [];
  }
  return configOption.options.flatMap((entry) =>
    "value" in entry
      ? [{ value: entry.value.trim(), name: entry.name.trim() }]
      : entry.options.map((option) => ({
          value: option.value.trim(),
          name: option.name.trim(),
          ...("group" in entry && typeof entry.group === "string" && entry.group.trim().length > 0
            ? { groupId: entry.group.trim() }
            : {}),
          ...("name" in entry && typeof entry.name === "string" && entry.name.trim().length > 0
            ? { groupName: entry.name.trim() }
            : {}),
        })),
  );
}

export function findCursorModelConfigOption(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
): EffectAcpSchema.SessionConfigOption | undefined {
  return configOptions.find((option) => option.category === "model");
}

export function findCursorConfigOption(
  options: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
  aliases: ReadonlyArray<string>,
): EffectAcpSchema.SessionConfigOption | undefined {
  const normalizedAliases = aliases.map(normalizedCursorText);
  return options.find((option) => {
    const haystack = normalizedCursorText(`${option.id} ${option.name} ${option.category ?? ""}`);
    return normalizedAliases.some((alias) => haystack.includes(alias));
  });
}

export function stripCursorParameterizedSuffix(value: string): string {
  const trimmed = value.trim();
  const suffixStart = trimmed.indexOf("[");
  return suffixStart >= 0 ? trimmed.slice(0, suffixStart).trim() : trimmed;
}

export function parseCursorModelParameters(value: string): ReadonlyMap<string, string> {
  const match = value.match(/\[([^\]]*)\]$/u);
  if (!match?.[1]) {
    return new Map();
  }
  const params = new Map<string, string>();
  for (const part of match[1].split(",")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = part.slice(0, separatorIndex).trim();
    const paramValue = part.slice(separatorIndex + 1).trim();
    if (key && paramValue) params.set(key, paramValue);
  }
  return params;
}

export function cursorModelParametersToObject(value: string): Record<string, string> {
  return Object.fromEntries(parseCursorModelParameters(value).entries());
}

export function buildCursorParameterizedModelSlug(
  baseModel: string,
  params: Record<string, string>,
): string {
  const entries = Object.entries(params).filter(([, value]) => value.trim().length > 0);
  if (entries.length === 0) return baseModel;
  return `${baseModel}[${entries.map(([key, value]) => `${key}=${value}`).join(",")}]`;
}

export function humanizeCursorModelName(value: string): string {
  const base = stripCursorParameterizedSuffix(value);
  if (base.length === 0) return value;
  const sharedDisplayName = formatModelDisplayName(base);
  if (sharedDisplayName) return sharedDisplayName;
  return base
    .split(/[-_/]+/u)
    .filter((part) => part.length > 0)
    .map((part) => {
      const lower = part.toLowerCase();
      if (/^gpt$/u.test(lower)) return "GPT";
      if (/^ai$/u.test(lower)) return "AI";
      if (/^codex$/u.test(lower)) return "Codex";
      if (/^claude$/u.test(lower)) return "Claude";
      if (/^opus$/u.test(lower)) return "Opus";
      if (/^sonnet$/u.test(lower)) return "Sonnet";
      if (/^haiku$/u.test(lower)) return "Haiku";
      if (/^gemini$/u.test(lower)) return "Gemini";
      if (/^grok$/u.test(lower)) return "Grok";
      if (/^kimi$/u.test(lower)) return "Kimi";
      if (/^llama$/u.test(lower)) return "Llama";
      if (/^qwen$/u.test(lower)) return "Qwen";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function normalizeCursorAcpModelName(choice: CursorAcpSelectOption): string {
  const rawName = choice.name.trim();
  const rawBase = stripCursorParameterizedSuffix(choice.value);
  if (
    rawName.length > 0 &&
    rawName.toLowerCase() !== choice.value.trim().toLowerCase() &&
    rawName.toLowerCase() !== rawBase.toLowerCase()
  ) {
    return rawName;
  }
  return humanizeCursorModelName(choice.value);
}

export function inferCursorUpstreamProvider(choice: CursorAcpSelectOption): {
  readonly upstreamProviderId: string;
  readonly upstreamProviderName: string;
} {
  const groupId = choice.groupId?.trim();
  const groupName = choice.groupName?.trim();
  if (groupId || groupName) {
    return {
      upstreamProviderId: (groupId || groupName || "cursor").toLowerCase().replace(/\s+/gu, "-"),
      upstreamProviderName: groupName || groupId || "Cursor",
    };
  }
  const token = stripCursorParameterizedSuffix(`${choice.value} ${choice.name}`)
    .trim()
    .toLowerCase();
  if (token.includes("claude"))
    return { upstreamProviderId: "anthropic", upstreamProviderName: "Anthropic" };
  if (token.includes("gemini"))
    return { upstreamProviderId: "google", upstreamProviderName: "Google" };
  if (token.includes("grok")) return { upstreamProviderId: "xai", upstreamProviderName: "xAI" };
  if (token.includes("kimi"))
    return { upstreamProviderId: "moonshot", upstreamProviderName: "Moonshot AI" };
  if (token.includes("deepseek"))
    return { upstreamProviderId: "deepseek", upstreamProviderName: "DeepSeek" };
  if (token.includes("qwen"))
    return { upstreamProviderId: "alibaba", upstreamProviderName: "Alibaba" };
  if (token.includes("llama")) return { upstreamProviderId: "meta", upstreamProviderName: "Meta" };
  if (token.includes("mistral"))
    return { upstreamProviderId: "mistral", upstreamProviderName: "Mistral" };
  if (token.includes("nemotron"))
    return { upstreamProviderId: "nvidia", upstreamProviderName: "NVIDIA" };
  if (
    token.includes("gpt") ||
    token.includes("codex") ||
    token.includes("o1") ||
    token.includes("o3") ||
    token.includes("o4")
  ) {
    return { upstreamProviderId: "openai", upstreamProviderName: "OpenAI" };
  }
  return { upstreamProviderId: "cursor", upstreamProviderName: "Cursor" };
}

export function flattenCursorAcpModelChoices(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
): ReadonlyArray<CursorAcpModelChoice> {
  const seen = new Set<string>();
  const choices: Array<CursorAcpModelChoice> = [];
  for (const choice of flattenCursorSessionConfigSelectOptions(
    findCursorModelConfigOption(configOptions),
  )) {
    if (!choice.value || seen.has(choice.value)) continue;
    seen.add(choice.value);
    choices.push({
      slug: choice.value,
      name: normalizeCursorAcpModelName(choice),
      ...inferCursorUpstreamProvider(choice),
    });
  }
  return choices;
}
