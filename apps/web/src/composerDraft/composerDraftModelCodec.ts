// FILE: composerDraftModelCodec.ts
// Purpose: Decode provider model selections and legacy option shapes.
// Layer: Web composer model codec

import {
  GROK_REASONING_EFFORT_OPTIONS,
  type ClaudeCodeEffort,
  type CodexReasoningEffort,
  type CursorModelOptions,
  type DroidReasoningEffort,
  type GrokReasoningEffort,
  type ModelSelection,
  type PiThinkingLevel,
  ProviderKind,
  type ProviderKind as ProviderKindType,
  type ProviderModelOptions,
} from "@agent-group/contracts";
import { getDefaultModel, normalizeModelSlug } from "@agent-group/shared/model";
import * as Schema from "effect/Schema";
import type { LegacyCodexFields } from "./composerDraftContracts";

export const COMPOSER_PROVIDER_KINDS = [
  "codex",
  "claudeAgent",
  "cursor",
  "antigravity",
  "grok",
  "droid",
  "kilo",
  "opencode",
  "pi",
] as const satisfies readonly ProviderKindType[];
const isProviderKind = Schema.is(ProviderKind);
const GROK_REASONING_EFFORT_SET = new Set<string>(GROK_REASONING_EFFORT_OPTIONS);
const ANTIGRAVITY_REASONING_EFFORT_SET = new Set(["low", "medium", "high", "thinking"]);

export function normalizeProviderKind(value: unknown): ProviderKind | null {
  if (value === "gemini") {
    return "antigravity";
  }
  return isProviderKind(value) ? value : null;
}

export function trimStringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isGrokReasoningEffort(value: unknown): value is GrokReasoningEffort {
  return typeof value === "string" && GROK_REASONING_EFFORT_SET.has(value);
}

export function makeModelSelection(
  provider: ProviderKind,
  model: string,
  options?: ProviderModelOptions[ProviderKind],
): ModelSelection {
  switch (provider) {
    case "antigravity":
      return {
        provider,
        model,
        ...(options
          ? {
              options: options as Extract<ModelSelection, { provider: "antigravity" }>["options"],
            }
          : {}),
      };
    case "codex":
      return {
        provider,
        model,
        ...(options
          ? { options: options as Extract<ModelSelection, { provider: "codex" }>["options"] }
          : {}),
      };
    case "claudeAgent":
      return {
        provider,
        model,
        ...(options
          ? {
              options: options as Extract<ModelSelection, { provider: "claudeAgent" }>["options"],
            }
          : {}),
      };
    case "cursor":
      return {
        provider,
        model,
        ...(options
          ? { options: options as Extract<ModelSelection, { provider: "cursor" }>["options"] }
          : {}),
      };
    case "grok":
      return {
        provider,
        model,
        ...(options
          ? { options: options as Extract<ModelSelection, { provider: "grok" }>["options"] }
          : {}),
      };
    case "droid":
      return {
        provider,
        model,
        ...(options
          ? { options: options as Extract<ModelSelection, { provider: "droid" }>["options"] }
          : {}),
      };
    case "kilo":
      return {
        provider,
        model,
        ...(options
          ? { options: options as Extract<ModelSelection, { provider: "kilo" }>["options"] }
          : {}),
      };
    case "opencode":
      return {
        provider,
        model,
        ...(options
          ? { options: options as Extract<ModelSelection, { provider: "opencode" }>["options"] }
          : {}),
      };
    case "pi":
      return {
        provider,
        model,
        ...(options
          ? { options: options as Extract<ModelSelection, { provider: "pi" }>["options"] }
          : {}),
      };
  }
}

export function normalizeProviderModelOptions(
  value: unknown,
  provider?: ProviderKind | null,
  legacy?: LegacyCodexFields,
): ProviderModelOptions | null {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const codexCandidate =
    candidate?.codex && typeof candidate.codex === "object"
      ? (candidate.codex as Record<string, unknown>)
      : null;
  const claudeCandidate =
    candidate?.claudeAgent && typeof candidate.claudeAgent === "object"
      ? (candidate.claudeAgent as Record<string, unknown>)
      : null;
  const cursorCandidate =
    candidate?.cursor && typeof candidate.cursor === "object"
      ? (candidate.cursor as Record<string, unknown>)
      : null;
  const antigravityCandidate =
    candidate?.antigravity && typeof candidate.antigravity === "object"
      ? (candidate.antigravity as Record<string, unknown>)
      : null;
  const grokCandidate =
    candidate?.grok && typeof candidate.grok === "object"
      ? (candidate.grok as Record<string, unknown>)
      : null;
  const droidCandidate =
    candidate?.droid && typeof candidate.droid === "object"
      ? (candidate.droid as Record<string, unknown>)
      : null;
  const openCodeCandidate =
    candidate?.opencode && typeof candidate.opencode === "object"
      ? (candidate.opencode as Record<string, unknown>)
      : null;
  const kiloCandidate =
    candidate?.kilo && typeof candidate.kilo === "object"
      ? (candidate.kilo as Record<string, unknown>)
      : null;
  const piCandidate =
    candidate?.pi && typeof candidate.pi === "object"
      ? (candidate.pi as Record<string, unknown>)
      : null;

  const codexReasoningEffort: CodexReasoningEffort | undefined =
    trimStringOrUndefined(codexCandidate?.reasoningEffort) ??
    (provider === "codex" ? trimStringOrUndefined(legacy?.effort) : undefined);
  const codexFastMode =
    codexCandidate?.fastMode === true
      ? true
      : codexCandidate?.fastMode === false
        ? false
        : (provider === "codex" && legacy?.codexFastMode === true) ||
            (typeof legacy?.serviceTier === "string" && legacy.serviceTier === "fast")
          ? true
          : undefined;
  const codex =
    codexReasoningEffort !== undefined || codexFastMode !== undefined
      ? {
          ...(codexReasoningEffort !== undefined ? { reasoningEffort: codexReasoningEffort } : {}),
          ...(codexFastMode !== undefined ? { fastMode: codexFastMode } : {}),
        }
      : undefined;

  const claudeThinking =
    claudeCandidate?.thinking === true
      ? true
      : claudeCandidate?.thinking === false
        ? false
        : undefined;
  const claudeEffort: ClaudeCodeEffort | undefined =
    claudeCandidate?.effort === "low" ||
    claudeCandidate?.effort === "medium" ||
    claudeCandidate?.effort === "high" ||
    claudeCandidate?.effort === "xhigh" ||
    claudeCandidate?.effort === "max" ||
    claudeCandidate?.effort === "ultrathink" ||
    claudeCandidate?.effort === "ultracode"
      ? claudeCandidate.effort
      : undefined;
  const claudeFastMode =
    claudeCandidate?.fastMode === true
      ? true
      : claudeCandidate?.fastMode === false
        ? false
        : undefined;
  const claudeAutoCompactWindow =
    trimStringOrUndefined(claudeCandidate?.autoCompactWindow) ??
    trimStringOrUndefined(claudeCandidate?.contextWindow);
  const claude =
    claudeThinking !== undefined ||
    claudeEffort !== undefined ||
    claudeFastMode !== undefined ||
    claudeAutoCompactWindow !== undefined
      ? {
          ...(claudeThinking !== undefined ? { thinking: claudeThinking } : {}),
          ...(claudeEffort !== undefined ? { effort: claudeEffort } : {}),
          ...(claudeFastMode !== undefined ? { fastMode: claudeFastMode } : {}),
          ...(claudeAutoCompactWindow !== undefined
            ? { autoCompactWindow: claudeAutoCompactWindow }
            : {}),
        }
      : undefined;

  const cursorReasoningEffort = trimStringOrUndefined(cursorCandidate?.reasoningEffort);
  const cursorFastMode =
    cursorCandidate?.fastMode === true
      ? true
      : cursorCandidate?.fastMode === false
        ? false
        : undefined;
  const cursorThinking =
    cursorCandidate?.thinking === true
      ? true
      : cursorCandidate?.thinking === false
        ? false
        : undefined;
  const cursorContextWindow = trimStringOrUndefined(cursorCandidate?.contextWindow);
  const cursor: CursorModelOptions | undefined =
    cursorReasoningEffort !== undefined ||
    cursorFastMode !== undefined ||
    cursorThinking !== undefined ||
    cursorContextWindow !== undefined
      ? {
          ...(cursorReasoningEffort !== undefined
            ? { reasoningEffort: cursorReasoningEffort }
            : {}),
          ...(cursorFastMode !== undefined ? { fastMode: cursorFastMode } : {}),
          ...(cursorThinking !== undefined ? { thinking: cursorThinking } : {}),
          ...(cursorContextWindow !== undefined ? { contextWindow: cursorContextWindow } : {}),
        }
      : undefined;

  const antigravityReasoningEffort = trimStringOrUndefined(antigravityCandidate?.reasoningEffort);
  const antigravity =
    antigravityReasoningEffort !== undefined
      ? { reasoningEffort: antigravityReasoningEffort }
      : undefined;
  const grokReasoningEffort: GrokReasoningEffort | undefined = isGrokReasoningEffort(
    grokCandidate?.reasoningEffort,
  )
    ? grokCandidate.reasoningEffort
    : undefined;
  const grok =
    grokReasoningEffort !== undefined ? { reasoningEffort: grokReasoningEffort } : undefined;
  const droidReasoningEffort: DroidReasoningEffort | undefined = trimStringOrUndefined(
    droidCandidate?.reasoningEffort,
  );
  const droid =
    droidReasoningEffort !== undefined ? { reasoningEffort: droidReasoningEffort } : undefined;
  const openCodeVariant = trimStringOrUndefined(openCodeCandidate?.variant);
  const openCodeAgent = trimStringOrUndefined(openCodeCandidate?.agent);
  const opencode =
    openCodeVariant !== undefined || openCodeAgent !== undefined
      ? {
          ...(openCodeVariant !== undefined ? { variant: openCodeVariant } : {}),
          ...(openCodeAgent !== undefined ? { agent: openCodeAgent } : {}),
        }
      : undefined;
  const kiloVariant = trimStringOrUndefined(kiloCandidate?.variant);
  const kiloAgent = trimStringOrUndefined(kiloCandidate?.agent);
  const kilo =
    kiloVariant !== undefined || kiloAgent !== undefined
      ? {
          ...(kiloVariant !== undefined ? { variant: kiloVariant } : {}),
          ...(kiloAgent !== undefined ? { agent: kiloAgent } : {}),
        }
      : undefined;
  const piThinkingLevel: PiThinkingLevel | undefined =
    piCandidate?.thinkingLevel === "off" ||
    piCandidate?.thinkingLevel === "minimal" ||
    piCandidate?.thinkingLevel === "low" ||
    piCandidate?.thinkingLevel === "medium" ||
    piCandidate?.thinkingLevel === "high" ||
    piCandidate?.thinkingLevel === "xhigh"
      ? piCandidate.thinkingLevel
      : undefined;
  const pi = piThinkingLevel !== undefined ? { thinkingLevel: piThinkingLevel } : undefined;
  if (
    !codex &&
    !claude &&
    !cursor &&
    !antigravity &&
    !grok &&
    !droid &&
    !kilo &&
    !opencode &&
    !pi
  ) {
    return null;
  }
  return {
    ...(codex ? { codex } : {}),
    ...(claude ? { claudeAgent: claude } : {}),
    ...(cursor ? { cursor } : {}),
    ...(antigravity ? { antigravity } : {}),
    ...(grok ? { grok } : {}),
    ...(droid ? { droid } : {}),
    ...(kilo ? { kilo } : {}),
    ...(opencode ? { opencode } : {}),
    ...(pi ? { pi } : {}),
  };
}

export function normalizeModelSelection(
  value: unknown,
  legacy?: {
    provider?: unknown;
    model?: unknown;
    modelOptions?: unknown;
    legacyCodex?: LegacyCodexFields;
  },
): ModelSelection | null {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const rawProvider = candidate?.provider ?? legacy?.provider;
  const migratedGeminiSelection = rawProvider === "gemini";
  const provider = normalizeProviderKind(rawProvider);
  if (provider === null) {
    return null;
  }
  const rawModel = candidate?.model ?? legacy?.model;
  if (typeof rawModel !== "string") {
    return null;
  }
  const antigravityLegacyMatch =
    provider === "antigravity" ? rawModel.trim().match(/^(.*?)\s+\(([^()]+)\)$/u) : null;
  const antigravityLegacyEffort = antigravityLegacyMatch?.[2]?.trim().toLowerCase();
  const hasLegacyAntigravityEffort =
    antigravityLegacyMatch?.[1] !== undefined &&
    antigravityLegacyEffort !== undefined &&
    ANTIGRAVITY_REASONING_EFFORT_SET.has(antigravityLegacyEffort);
  const normalizedRawModel = migratedGeminiSelection
    ? getDefaultModel("antigravity")
    : hasLegacyAntigravityEffort
      ? antigravityLegacyMatch[1]!.trim()
      : rawModel;
  const inferredClaudeAutoCompactWindow =
    provider === "claudeAgent" && /\[1m\]$/iu.test(rawModel) ? "1m" : undefined;
  const model = normalizeModelSlug(normalizedRawModel, provider);
  if (!model) {
    return null;
  }
  const modelOptions = migratedGeminiSelection
    ? null
    : normalizeProviderModelOptions(
        candidate?.options ? { [provider]: candidate.options } : legacy?.modelOptions,
        provider,
        provider === "codex" ? legacy?.legacyCodex : undefined,
      );
  const options =
    provider === "codex"
      ? modelOptions?.codex
      : provider === "claudeAgent"
        ? inferredClaudeAutoCompactWindow !== undefined
          ? {
              ...modelOptions?.claudeAgent,
              autoCompactWindow:
                modelOptions?.claudeAgent?.autoCompactWindow ?? inferredClaudeAutoCompactWindow,
            }
          : modelOptions?.claudeAgent
        : provider === "antigravity"
          ? modelOptions?.antigravity
          : provider === "grok"
            ? modelOptions?.grok
            : provider === "droid"
              ? modelOptions?.droid
              : provider === "kilo"
                ? modelOptions?.kilo
                : provider === "cursor"
                  ? modelOptions?.cursor
                  : provider === "opencode"
                    ? modelOptions?.opencode
                    : provider === "pi"
                      ? modelOptions?.pi
                      : undefined;
  const normalizedOptions =
    provider === "antigravity" && hasLegacyAntigravityEffort
      ? {
          reasoningEffort: modelOptions?.antigravity?.reasoningEffort ?? antigravityLegacyEffort,
        }
      : options;
  return makeModelSelection(provider, model, normalizedOptions);
}
