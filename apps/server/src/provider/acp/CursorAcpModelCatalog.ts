import type { ProviderModelDescriptor } from "@agent-group/contracts";
import { Effect, Schema } from "effect";
import * as EffectAcpErrors from "effect-acp/errors";
import * as EffectAcpSchema from "effect-acp/schema";

import type { AcpSessionRuntimeShape } from "./AcpSessionRuntime.ts";
import {
  cursorModelOptionsFromCliModelId,
  cursorReasoningLabel,
  findCursorEffortConfigOption,
  isCursorContextConfigOption,
  normalizeCursorReasoningValue,
} from "./CursorAcpModelOptions.ts";
import {
  flattenCursorSessionConfigSelectOptions,
  humanizeCursorModelName,
  inferCursorUpstreamProvider,
} from "./CursorAcpModelValues.ts";

export function parseCursorCliModelList(stdout: string): ReadonlyArray<ProviderModelDescriptor> {
  const seen = new Set<string>();
  const models: Array<ProviderModelDescriptor> = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "Available models" || trimmed.startsWith("Tip:")) continue;
    const separatorIndex = trimmed.indexOf(" - ");
    if (separatorIndex <= 0) continue;
    const slug = trimmed.slice(0, separatorIndex).trim();
    const rawName = trimmed.slice(separatorIndex + 3).trim();
    if (!slug || !rawName || seen.has(slug)) continue;
    seen.add(slug);
    const name = rawName.replace(/\s+\((?:default|current)\)$/iu, "").trim() || rawName;
    const options = cursorModelOptionsFromCliModelId(slug);
    models.push({
      slug,
      name,
      ...inferCursorUpstreamProvider({ value: slug, name }),
      ...(options.fastMode === true ? { supportsFastMode: true } : {}),
      ...(options.thinking === true ? { supportsThinkingToggle: true } : {}),
      ...(options.reasoningEffort
        ? {
            supportedReasoningEfforts: [
              {
                value: options.reasoningEffort,
                label: cursorReasoningLabel(options.reasoningEffort),
              },
            ],
            defaultReasoningEffort: options.reasoningEffort,
          }
        : {}),
      ...(options.contextWindow
        ? {
            contextWindowOptions: [
              {
                value: options.contextWindow,
                label: options.contextWindow === "1m" ? "1M" : options.contextWindow.toUpperCase(),
                isDefault: true as const,
              },
            ],
            defaultContextWindow: options.contextWindow,
          }
        : {}),
    });
  }
  return models;
}

export const CURSOR_LIST_AVAILABLE_MODELS_METHOD = "cursor/list_available_models";
const CURSOR_ACP_AUTO_MODEL_ID = "default";

const CursorAcpAvailableModel = Schema.Struct({
  value: Schema.String,
  name: Schema.optional(Schema.Union([Schema.String, Schema.Null])),
  configOptions: Schema.optional(Schema.Array(EffectAcpSchema.SessionConfigOption)),
});
export type CursorAcpAvailableModel = typeof CursorAcpAvailableModel.Type;

const CursorAcpListAvailableModelsResult = Schema.Struct({
  models: Schema.Array(CursorAcpAvailableModel),
});
const decodeCursorAcpListAvailableModelsResult = Schema.decodeUnknownEffect(
  CursorAcpListAvailableModelsResult,
);

function cursorContextWindowLabel(value: string): string {
  const normalized = value.trim();
  return normalized.toLowerCase() === "1m" ? "1M" : normalized.toUpperCase();
}

function findCursorThinkingConfigOption(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
): EffectAcpSchema.SessionConfigOption | undefined {
  return configOptions.find((option) => option.id.trim().toLowerCase() === "thinking");
}

function findCursorFastConfigOption(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
): EffectAcpSchema.SessionConfigOption | undefined {
  return configOptions.find((option) => option.id.trim().toLowerCase() === "fast");
}

function buildCursorAcpAvailableModelDescriptor(
  model: CursorAcpAvailableModel,
): ProviderModelDescriptor | undefined {
  const rawSlug = model.value.trim();
  if (!rawSlug) return undefined;
  const slug = rawSlug === CURSOR_ACP_AUTO_MODEL_ID ? "auto" : rawSlug;
  const configOptions = model.configOptions ?? [];
  const effortOption = findCursorEffortConfigOption(configOptions);
  const supportedReasoningEfforts =
    effortOption?.type === "select"
      ? flattenCursorSessionConfigSelectOptions(effortOption).flatMap((entry) => {
          const value = normalizeCursorReasoningValue(entry.value);
          return value ? [{ value, label: cursorReasoningLabel(value) }] : [];
        })
      : [];
  const defaultReasoningEffort =
    effortOption?.type === "select"
      ? normalizeCursorReasoningValue(effortOption.currentValue)
      : undefined;
  const contextOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorContextConfigOption(option),
  );
  const contextWindowOptions =
    contextOption?.type === "select"
      ? flattenCursorSessionConfigSelectOptions(contextOption).map((entry) =>
          contextOption.currentValue === entry.value
            ? {
                value: entry.value,
                label: cursorContextWindowLabel(entry.value),
                isDefault: true as const,
              }
            : { value: entry.value, label: cursorContextWindowLabel(entry.value) },
        )
      : [];
  const defaultContextWindow = contextWindowOptions.find((option) => option.isDefault)?.value;
  const name = model.name?.trim() || humanizeCursorModelName(slug);
  return {
    slug,
    name,
    ...inferCursorUpstreamProvider({ value: slug, name }),
    ...(supportedReasoningEfforts.length > 0
      ? {
          supportedReasoningEfforts,
          ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
        }
      : {}),
    ...(findCursorFastConfigOption(configOptions) ? { supportsFastMode: true as const } : {}),
    ...(findCursorThinkingConfigOption(configOptions)
      ? { supportsThinkingToggle: true as const }
      : {}),
    ...(contextWindowOptions.length > 0
      ? {
          contextWindowOptions,
          ...(defaultContextWindow ? { defaultContextWindow } : {}),
        }
      : {}),
  };
}

export function buildCursorAcpModelDescriptorsFromAvailableModels(
  models: ReadonlyArray<CursorAcpAvailableModel>,
): ReadonlyArray<ProviderModelDescriptor> {
  const seen = new Set<string>();
  const descriptors: Array<ProviderModelDescriptor> = [];
  for (const model of models) {
    const descriptor = buildCursorAcpAvailableModelDescriptor(model);
    if (!descriptor || seen.has(descriptor.slug)) continue;
    seen.add(descriptor.slug);
    descriptors.push(descriptor);
  }
  return descriptors;
}

export function fetchCursorAcpModelDescriptors(
  runtime: Pick<AcpSessionRuntimeShape, "request">,
  sessionId: string,
): Effect.Effect<ReadonlyArray<ProviderModelDescriptor>, EffectAcpErrors.AcpError> {
  return runtime.request(CURSOR_LIST_AVAILABLE_MODELS_METHOD, { sessionId }).pipe(
    Effect.flatMap((raw) =>
      decodeCursorAcpListAvailableModelsResult(raw).pipe(
        Effect.mapError((cause) =>
          EffectAcpErrors.AcpRequestError.parseError(
            "Failed to decode Cursor available models response.",
            cause,
          ),
        ),
      ),
    ),
    Effect.map((result) => buildCursorAcpModelDescriptorsFromAvailableModels(result.models)),
  );
}
