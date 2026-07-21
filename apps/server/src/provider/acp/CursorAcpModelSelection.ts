import type { CursorModelOptions } from "@agent-group/contracts";
import { Effect } from "effect";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import type { AcpSessionRuntimeShape } from "./AcpSessionRuntime.ts";
import {
  cursorAcpParameterKeyForModel,
  cursorModelOptionsFromCliModelId,
  cursorReasoningParameterValue,
  normalizeCursorCliBaseModelId,
  normalizeCursorReasoningValue,
  toCursorConfigValue,
} from "./CursorAcpModelOptions.ts";
import {
  buildCursorParameterizedModelSlug,
  cursorModelParametersToObject,
  findCursorConfigOption,
  flattenCursorAcpModelChoices,
  normalizedCursorText,
  parseCursorModelParameters,
  resolveCursorAcpBaseModelId,
  stripCursorParameterizedSuffix,
  type CursorAcpModelChoice,
} from "./CursorAcpModelValues.ts";

interface CursorAcpModelSelectionRuntime {
  readonly getConfigOptions: AcpSessionRuntimeShape["getConfigOptions"];
  readonly setConfigOption: (
    configId: string,
    value: string | boolean,
  ) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
  readonly setModel: (model: string) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
}

export interface CursorAcpModelSelectionErrorContext {
  readonly cause: EffectAcpErrors.AcpError;
  readonly step: "set-config-option" | "set-model";
  readonly configId?: string;
}

function buildCursorParameterizedModelFromCliModelId(input: {
  readonly acpModelValue: string;
  readonly cliModel: string;
  readonly choices: ReadonlyArray<CursorAcpModelChoice>;
}): string | undefined {
  if (!input.acpModelValue.includes("[")) return undefined;
  const cliOptions = cursorModelOptionsFromCliModelId(input.cliModel);
  if (Object.keys(cliOptions).length === 0) return undefined;
  const baseModel = stripCursorParameterizedSuffix(input.acpModelValue);
  const params = cursorModelParametersToObject(input.acpModelValue);
  if (cliOptions.reasoningEffort) {
    const parameterKey = cursorAcpParameterKeyForModel(baseModel, cliOptions);
    params[parameterKey] =
      resolveCursorChoiceParameterValue({
        choices: input.choices,
        baseModel,
        key: parameterKey,
        requestedValue: cliOptions.reasoningEffort,
      }) ?? cursorReasoningParameterValue(cliOptions.reasoningEffort);
  }
  if (cliOptions.contextWindow) params.context = cliOptions.contextWindow;
  if (cliOptions.fastMode !== undefined) params.fast = String(cliOptions.fastMode);
  if (cliOptions.thinking !== undefined) params.thinking = String(cliOptions.thinking);
  return buildCursorParameterizedModelSlug(baseModel, params);
}

function buildCursorParameterizedModelFromOptions(input: {
  readonly acpModelValue: string;
  readonly options: CursorModelOptions | null | undefined;
  readonly choices: ReadonlyArray<CursorAcpModelChoice>;
}): string | undefined {
  if (!input.acpModelValue.includes("[")) return undefined;
  if (!input.options || Object.keys(input.options).length === 0) return undefined;
  const baseModel = stripCursorParameterizedSuffix(input.acpModelValue);
  const params = cursorModelParametersToObject(input.acpModelValue);
  if (input.options.reasoningEffort) {
    const parameterKey = cursorAcpParameterKeyForModel(baseModel, input.options);
    params[parameterKey] =
      resolveCursorChoiceParameterValue({
        choices: input.choices,
        baseModel,
        key: parameterKey,
        requestedValue: input.options.reasoningEffort,
      }) ?? cursorReasoningParameterValue(input.options.reasoningEffort);
  }
  if (input.options.contextWindow) params.context = input.options.contextWindow;
  if (input.options.fastMode !== undefined) params.fast = String(input.options.fastMode);
  if (input.options.thinking !== undefined) params.thinking = String(input.options.thinking);
  return buildCursorParameterizedModelSlug(baseModel, params);
}

function cursorChoiceMatchesBase(choice: CursorAcpModelChoice, baseModel: string): boolean {
  const choiceBase = resolveCursorAcpBaseModelId(choice.slug);
  const cliBaseModel = normalizeCursorCliBaseModelId(baseModel);
  return choiceBase === baseModel || choiceBase === cliBaseModel;
}

function cursorParameterValuesMatch(key: string, left: string, right: string): boolean {
  if (key === "reasoning" || key === "effort") {
    return normalizeCursorReasoningValue(left) === normalizeCursorReasoningValue(right);
  }
  return normalizedCursorText(left) === normalizedCursorText(right);
}

function resolveCursorChoiceParameterValue(input: {
  readonly choices: ReadonlyArray<CursorAcpModelChoice>;
  readonly baseModel: string;
  readonly key: string;
  readonly requestedValue: string;
}): string | undefined {
  let sawParameterizedChoice = false;
  for (const choice of input.choices) {
    if (!cursorChoiceMatchesBase(choice, input.baseModel)) continue;
    const value = parseCursorModelParameters(choice.slug).get(input.key);
    if (!value) continue;
    sawParameterizedChoice = true;
    if (cursorParameterValuesMatch(input.key, value, input.requestedValue)) return value;
  }
  return sawParameterizedChoice ? undefined : input.requestedValue;
}

function cursorModelOptionValueSupported(input: {
  readonly configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>;
  readonly choices: ReadonlyArray<CursorAcpModelChoice>;
  readonly baseModel: string;
  readonly aliases: ReadonlyArray<string>;
  readonly parameterKey: string;
  readonly value: string | boolean;
}): boolean {
  const option = findCursorConfigOption(input.configOptions, input.aliases);
  if (option) return toCursorConfigValue(option, input.value) !== undefined;
  if (typeof input.value === "boolean") {
    if (
      input.value === false &&
      (input.parameterKey === "fast" || input.parameterKey === "thinking")
    ) {
      return true;
    }
  }
  return (
    resolveCursorChoiceParameterValue({
      choices: input.choices,
      baseModel: input.baseModel,
      key: input.parameterKey,
      requestedValue: String(input.value),
    }) !== undefined
  );
}

function normalizeCursorAcpRuntimeOptions(input: {
  readonly configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>;
  readonly choices: ReadonlyArray<CursorAcpModelChoice>;
  readonly baseModel: string;
  readonly options: CursorModelOptions | null | undefined;
}): CursorModelOptions | undefined {
  if (!input.options) return undefined;
  const nextOptions: {
    reasoningEffort?: string;
    contextWindow?: string;
    fastMode?: boolean;
    thinking?: boolean;
  } = {};
  if (input.options.reasoningEffort) {
    const parameterKey = cursorAcpParameterKeyForModel(input.baseModel, input.options);
    if (
      cursorModelOptionValueSupported({
        configOptions: input.configOptions,
        choices: input.choices,
        baseModel: input.baseModel,
        aliases: ["effort", "reasoning", "thought level"],
        parameterKey,
        value: input.options.reasoningEffort,
      })
    ) {
      nextOptions.reasoningEffort = input.options.reasoningEffort;
    }
  }
  if (
    input.options.contextWindow &&
    cursorModelOptionValueSupported({
      configOptions: input.configOptions,
      choices: input.choices,
      baseModel: input.baseModel,
      aliases: ["context", "context size", "context window"],
      parameterKey: "context",
      value: input.options.contextWindow,
    })
  ) {
    nextOptions.contextWindow = input.options.contextWindow;
  }
  if (
    input.options.fastMode !== undefined &&
    cursorModelOptionValueSupported({
      configOptions: input.configOptions,
      choices: input.choices,
      baseModel: input.baseModel,
      aliases: ["fast", "fast mode"],
      parameterKey: "fast",
      value: input.options.fastMode,
    })
  ) {
    nextOptions.fastMode = input.options.fastMode;
  }
  if (
    input.options.thinking !== undefined &&
    cursorModelOptionValueSupported({
      configOptions: input.configOptions,
      choices: input.choices,
      baseModel: input.baseModel,
      aliases: ["thinking"],
      parameterKey: "thinking",
      value: input.options.thinking,
    })
  ) {
    nextOptions.thinking = input.options.thinking;
  }
  return Object.keys(nextOptions).length > 0 ? nextOptions : undefined;
}

function collectCursorAcpConfigUpdates(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
  options: CursorModelOptions | null | undefined,
): ReadonlyArray<{ readonly configId: string; readonly value: string | boolean }> {
  if (!options) return [];
  const updates: Array<{ readonly configId: string; readonly value: string | boolean }> = [];
  const pushUpdate = (
    aliases: ReadonlyArray<string>,
    value: string | boolean | undefined,
  ): void => {
    if (value === undefined) return;
    const option = findCursorConfigOption(configOptions, aliases);
    if (!option) return;
    const configValue = toCursorConfigValue(option, value);
    if (configValue !== undefined) updates.push({ configId: option.id, value: configValue });
  };
  pushUpdate(["effort", "reasoning", "thought level"], options.reasoningEffort);
  pushUpdate(["context", "context size", "context window"], options.contextWindow);
  pushUpdate(["fast", "fast mode"], options.fastMode);
  pushUpdate(["thinking"], options.thinking);
  return updates;
}

function cursorModelOptionsFromModelParameters(
  model: string | null | undefined,
): CursorModelOptions | undefined {
  if (!model) return undefined;
  const params = parseCursorModelParameters(model);
  const reasoningEffort = normalizeCursorReasoningValue(
    params.get("reasoning") ?? params.get("effort"),
  );
  const contextWindow = params.get("context")?.trim();
  const fastModeParam = params.get("fast")?.trim().toLowerCase();
  const thinkingParam = params.get("thinking")?.trim().toLowerCase();
  const fastMode = fastModeParam === "true" ? true : fastModeParam === "false" ? false : undefined;
  const thinking = thinkingParam === "true" ? true : thinkingParam === "false" ? false : undefined;
  const options: CursorModelOptions = {
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(fastMode !== undefined ? { fastMode } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
  };
  return Object.keys(options).length > 0 ? options : undefined;
}

function mergeCursorModelOptions(
  base: CursorModelOptions | undefined,
  override: CursorModelOptions | null | undefined,
): CursorModelOptions | undefined {
  const merged: CursorModelOptions = { ...(base ?? {}), ...(override ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function cursorModelParametersEqualExceptFast(left: string, right: string): boolean {
  const leftParams = cursorModelParametersToObject(left);
  const rightParams = cursorModelParametersToObject(right);
  delete leftParams.fast;
  delete rightParams.fast;
  return JSON.stringify(leftParams) === JSON.stringify(rightParams);
}

function findCursorModelChoiceIgnoringFast(
  choices: ReadonlyArray<CursorAcpModelChoice>,
  model: string,
): string | undefined {
  const requestedParams = parseCursorModelParameters(model);
  if (requestedParams.get("fast") !== "true") return undefined;
  const baseModel = stripCursorParameterizedSuffix(model);
  return choices.find(
    (choice) =>
      stripCursorParameterizedSuffix(choice.slug) === baseModel &&
      parseCursorModelParameters(choice.slug).has("fast") &&
      cursorModelParametersEqualExceptFast(choice.slug, model),
  )?.slug;
}

function cursorModelChoiceSupportsRequestedParameters(choice: string, requested: string): boolean {
  if (stripCursorParameterizedSuffix(choice) !== stripCursorParameterizedSuffix(requested)) {
    return false;
  }
  const choiceParams = parseCursorModelParameters(choice);
  const requestedParams = parseCursorModelParameters(requested);
  for (const [key, requestedValue] of requestedParams) {
    const choiceValue = choiceParams.get(key);
    if (choiceValue === requestedValue) continue;
    if ((key === "fast" || key === "thinking") && requestedValue === "false") continue;
    return false;
  }
  return true;
}

function findCursorModelChoiceWithSupportedParameters(
  choices: ReadonlyArray<CursorAcpModelChoice>,
  model: string,
): string | undefined {
  return choices.find((choice) => cursorModelChoiceSupportsRequestedParameters(choice.slug, model))
    ?.slug;
}

function resolveCursorAutoModelValue(
  choices: ReadonlyArray<CursorAcpModelChoice>,
): string | undefined {
  return (
    choices.find((choice) => choice.slug.trim().toLowerCase() === "auto")?.slug ??
    choices.find((choice) => normalizedCursorText(choice.name) === "auto")?.slug
  );
}

function resolveCursorAcpModelValue(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
  model: string | null | undefined,
  options: CursorModelOptions | null | undefined,
): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed) return undefined;
  const choices = flattenCursorAcpModelChoices(configOptions);
  if (trimmed === "auto") return resolveCursorAutoModelValue(choices);
  const exactChoice = choices.find((choice) => choice.slug === trimmed);
  if (exactChoice) return exactChoice.slug;
  const baseModel = resolveCursorAcpBaseModelId(trimmed);
  if (baseModel === "auto") return undefined;
  const cliBaseModel = normalizeCursorCliBaseModelId(baseModel);
  const acpModelValue =
    choices.find((choice) => choice.slug === baseModel)?.slug ??
    choices.find((choice) => resolveCursorAcpBaseModelId(choice.slug) === baseModel)?.slug ??
    choices.find((choice) => resolveCursorAcpBaseModelId(choice.slug) === cliBaseModel)?.slug ??
    baseModel;
  const inferredModel =
    buildCursorParameterizedModelFromCliModelId({
      acpModelValue,
      cliModel: trimmed,
      choices,
    }) ?? acpModelValue;
  const resolvedModel =
    buildCursorParameterizedModelFromOptions({
      acpModelValue: inferredModel,
      options,
      choices,
    }) ?? inferredModel;
  if (choices.some((choice) => choice.slug === resolvedModel)) return resolvedModel;
  return (
    findCursorModelChoiceIgnoringFast(choices, resolvedModel) ??
    findCursorModelChoiceWithSupportedParameters(choices, resolvedModel) ??
    resolvedModel
  );
}

export function applyCursorAcpModelSelection<E>(input: {
  readonly runtime: CursorAcpModelSelectionRuntime;
  readonly model: string | null | undefined;
  readonly options: CursorModelOptions | null | undefined;
  readonly mapError: (context: CursorAcpModelSelectionErrorContext) => E;
}): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    const initialConfigOptions = yield* input.runtime.getConfigOptions;
    const choices = flattenCursorAcpModelChoices(initialConfigOptions);
    const baseModel = resolveCursorAcpBaseModelId(input.model);
    const runtimeSafeOptions = normalizeCursorAcpRuntimeOptions({
      configOptions: initialConfigOptions,
      choices,
      baseModel,
      options: mergeCursorModelOptions(
        cursorModelOptionsFromModelParameters(input.model),
        input.options,
      ),
    });
    const mergedOptions = mergeCursorModelOptions(
      cursorModelOptionsFromCliModelId(input.model),
      runtimeSafeOptions,
    );
    const modelValue = resolveCursorAcpModelValue(initialConfigOptions, input.model, mergedOptions);
    if (modelValue) {
      yield* input.runtime
        .setModel(modelValue)
        .pipe(Effect.mapError((cause) => input.mapError({ cause, step: "set-model" })));
    }
    const configUpdates = collectCursorAcpConfigUpdates(
      yield* input.runtime.getConfigOptions,
      mergedOptions,
    );
    for (const update of configUpdates) {
      yield* input.runtime
        .setConfigOption(update.configId, update.value)
        .pipe(
          Effect.mapError((cause) =>
            input.mapError({ cause, step: "set-config-option", configId: update.configId }),
          ),
        );
    }
  });
}
