import type { CursorModelOptions } from "@agent-group/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";

import { normalizedCursorText } from "./CursorAcpModelValues.ts";

export function normalizeCursorCliBaseModelId(model: string): string {
  const trimmed = model.trim();
  const withoutVariantSuffixes = trimmed
    .replace(/-fast$/u, "")
    .replace(/-(?:extra-high|none|low|medium|high|xhigh)$/u, "")
    .replace(/-thinking$/u, "")
    .replace(/-fast$/u, "")
    .replace(/-(?:extra-high|none|low|medium|high|xhigh)$/u, "")
    .replace(/^claude-(\d+(?:\.\d+)?)-([a-z]+)-max$/u, "claude-$1-$2")
    .replace(/-preview$/u, "");

  const claudeReordered = withoutVariantSuffixes.match(/^claude-(\d+(?:\.\d+)?)-([a-z]+)$/u);
  if (claudeReordered) {
    const version = claudeReordered[1];
    const family = claudeReordered[2];
    if (!version || !family) return withoutVariantSuffixes;
    return `claude-${family}-${version.replace(".", "-")}`;
  }
  return withoutVariantSuffixes;
}

function parseCursorCliReasoningEffort(model: string): string | undefined {
  const tokens = model.trim().toLowerCase().split("-");
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (!token) continue;
    if (token === "xhigh") return "xhigh";
    if (token === "high" && tokens[index - 1] === "extra") return "xhigh";
    if (
      token === "max" ||
      token === "none" ||
      token === "low" ||
      token === "medium" ||
      token === "high"
    ) {
      return token;
    }
  }
  return undefined;
}

function isCursorCliOneMillionContextModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (normalized.startsWith("gpt-5.5-")) return true;
  if (/^gpt-5\.4-(?:low|medium|high|xhigh|extra-high)$/u.test(normalized)) return true;
  if (/^claude-4\.6-(?:opus|sonnet)(?:-|$)/u.test(normalized)) return true;
  return /^claude-(?:fable-5|opus-4-(?:7|8))-/u.test(normalized);
}

export function cursorModelOptionsFromCliModelId(
  model: string | null | undefined,
): CursorModelOptions {
  const trimmed = model?.trim();
  if (!trimmed || trimmed.includes("[")) return {};
  const lower = trimmed.toLowerCase();
  const reasoningEffort = parseCursorCliReasoningEffort(lower);
  return {
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(lower.endsWith("-fast") ? { fastMode: true } : {}),
    ...(lower.includes("-thinking") ? { thinking: true } : {}),
    ...(isCursorCliOneMillionContextModel(lower) ? { contextWindow: "1m" } : {}),
  };
}

export function cursorAcpParameterKeyForModel(
  baseModel: string,
  options: CursorModelOptions,
): string {
  return options.reasoningEffort && baseModel.includes("claude") ? "effort" : "reasoning";
}

export function normalizeCursorReasoningValue(
  value: string | null | undefined,
): string | undefined {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case "low":
    case "medium":
    case "high":
    case "max":
      return normalized;
    case "xhigh":
    case "extra-high":
    case "extra high":
      return "xhigh";
    default:
      return undefined;
  }
}

export function cursorReasoningParameterValue(value: string): string {
  return value === "xhigh" ? "extra-high" : value;
}

export function cursorReasoningLabel(value: string): string {
  switch (value) {
    case "xhigh":
      return "Extra High";
    case "max":
      return "Max";
    default:
      return value.charAt(0).toUpperCase() + value.slice(1);
  }
}

function isCursorEffortConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  const id = option.id.trim().toLowerCase();
  const name = option.name.trim().toLowerCase();
  return (
    id === "effort" ||
    id === "reasoning" ||
    name === "effort" ||
    name === "reasoning" ||
    name.includes("effort") ||
    name.includes("reasoning")
  );
}

export function findCursorEffortConfigOption(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
): EffectAcpSchema.SessionConfigOption | undefined {
  const candidates = configOptions.filter(
    (option) => option.type === "select" && isCursorEffortConfigOption(option),
  );
  return (
    candidates.find((option) => option.category === "model_option") ??
    candidates.find((option) => option.id.trim().toLowerCase() === "effort") ??
    candidates.find((option) => option.category === "thought_level") ??
    candidates[0]
  );
}

export function isCursorContextConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  const id = option.id.trim().toLowerCase();
  const name = option.name.trim().toLowerCase();
  return id === "context" || id === "context_size" || name.includes("context");
}

export function toCursorConfigValue(
  option: EffectAcpSchema.SessionConfigOption,
  value: string | boolean,
): string | boolean | undefined {
  if (option.type === "boolean") {
    return typeof value === "boolean" ? value : value.toLowerCase() === "true";
  }
  if (option.type !== "select") return undefined;
  const stringValue = String(value).trim();
  if (!stringValue) return undefined;
  const normalized = normalizedCursorText(stringValue);
  const normalizedAliases =
    normalized === "xhigh" || normalized === "extra high"
      ? new Set([normalized, "xhigh", "extra high"])
      : new Set([normalized]);
  for (const entry of option.options) {
    const candidates =
      "value" in entry
        ? [{ value: entry.value, name: entry.name }]
        : entry.options.map((nested) => ({ value: nested.value, name: nested.name }));
    for (const candidate of candidates) {
      const normalizedValue = normalizedCursorText(candidate.value);
      const normalizedName = normalizedCursorText(candidate.name);
      if (normalizedAliases.has(normalizedValue) || normalizedAliases.has(normalizedName)) {
        return candidate.value;
      }
    }
  }
  return undefined;
}
