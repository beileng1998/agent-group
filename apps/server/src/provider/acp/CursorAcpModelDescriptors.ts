import type { ProviderModelDescriptor } from "@agent-group/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  cursorReasoningLabel,
  cursorReasoningParameterValue,
  findCursorEffortConfigOption,
  isCursorContextConfigOption,
  normalizeCursorReasoningValue,
} from "./CursorAcpModelOptions.ts";
import {
  buildCursorParameterizedModelSlug,
  cursorModelParametersToObject,
  flattenCursorAcpModelChoices,
  flattenCursorSessionConfigSelectOptions,
  stripCursorParameterizedSuffix,
  type CursorAcpModelChoice,
} from "./CursorAcpModelValues.ts";

function cursorContextLabel(
  value: string,
  contextWindowOptions: NonNullable<ProviderModelDescriptor["contextWindowOptions"]>,
): string {
  return (
    contextWindowOptions.find((option) => option.value === value)?.label ?? value.toUpperCase()
  );
}

function withCursorVariantName(
  baseName: string,
  effort: string | undefined,
  defaultEffort: string | undefined,
  contextWindow: string | undefined,
  defaultContextWindow: string | undefined,
  contextWindowOptions: NonNullable<ProviderModelDescriptor["contextWindowOptions"]>,
  fastMode: boolean | undefined,
): string {
  const suffixes: Array<string> = [];
  if (effort && effort !== defaultEffort) suffixes.push(cursorReasoningLabel(effort));
  if (contextWindow && contextWindow !== defaultContextWindow) {
    suffixes.push(cursorContextLabel(contextWindow, contextWindowOptions));
  }
  if (fastMode) suffixes.push("Fast");
  return suffixes.length === 0 ? baseName : `${baseName} ${suffixes.join(" ")}`;
}

function buildCursorAcpModelDescriptor(input: {
  readonly choice: CursorAcpModelChoice;
  readonly slug: string;
  readonly name: string;
  readonly supportedReasoningEfforts: NonNullable<
    ProviderModelDescriptor["supportedReasoningEfforts"]
  >;
  readonly defaultReasoningEffort?: string;
  readonly contextWindowOptions: NonNullable<ProviderModelDescriptor["contextWindowOptions"]>;
  readonly defaultContextWindow?: string;
}): ProviderModelDescriptor {
  return {
    slug: input.slug,
    name: input.name,
    ...(input.choice.upstreamProviderId
      ? { upstreamProviderId: input.choice.upstreamProviderId }
      : {}),
    ...(input.choice.upstreamProviderName
      ? { upstreamProviderName: input.choice.upstreamProviderName }
      : {}),
    ...(input.supportedReasoningEfforts.length > 0 && input.defaultReasoningEffort
      ? {
          supportedReasoningEfforts: input.supportedReasoningEfforts,
          defaultReasoningEffort: input.defaultReasoningEffort,
        }
      : {}),
    ...(input.contextWindowOptions.length > 0 && input.defaultContextWindow
      ? {
          contextWindowOptions: input.contextWindowOptions.map((option) => ({
            value: option.value,
            label: option.label,
            ...(option.value === input.defaultContextWindow ? { isDefault: true as const } : {}),
          })),
          defaultContextWindow: input.defaultContextWindow,
        }
      : {}),
  };
}

function expandCursorParameterizedModelDescriptors(input: {
  readonly choice: CursorAcpModelChoice;
  readonly supportedReasoningEfforts: NonNullable<
    ProviderModelDescriptor["supportedReasoningEfforts"]
  >;
  readonly defaultReasoningEffort?: string;
  readonly contextWindowOptions: NonNullable<ProviderModelDescriptor["contextWindowOptions"]>;
  readonly defaultContextWindow?: string;
}): ReadonlyArray<ProviderModelDescriptor> {
  const params = cursorModelParametersToObject(input.choice.slug);
  const reasoningKey =
    params.reasoning !== undefined ? "reasoning" : params.effort !== undefined ? "effort" : null;
  const parameterReasoningEffort = normalizeCursorReasoningValue(
    reasoningKey ? params[reasoningKey] : undefined,
  );
  const parameterContextWindow = params.context;
  const hasFastParameter = params.fast !== undefined;
  const canExpandReasoning = Boolean(reasoningKey && input.supportedReasoningEfforts.length > 0);
  const canExpandContext = Boolean(parameterContextWindow && input.contextWindowOptions.length > 1);
  const canExpandFast = hasFastParameter;

  if (!canExpandReasoning && !canExpandContext && !canExpandFast) {
    return [
      buildCursorAcpModelDescriptor({
        choice: input.choice,
        slug: input.choice.slug,
        name: input.choice.name,
        supportedReasoningEfforts: input.supportedReasoningEfforts,
        ...(parameterReasoningEffort ? { defaultReasoningEffort: parameterReasoningEffort } : {}),
        contextWindowOptions: input.contextWindowOptions,
        ...(parameterContextWindow ? { defaultContextWindow: parameterContextWindow } : {}),
      }),
    ];
  }

  const baseModel = stripCursorParameterizedSuffix(input.choice.slug);
  const reasoningValues = canExpandReasoning
    ? input.supportedReasoningEfforts.map((effort) => effort.value)
    : [parameterReasoningEffort].filter((value): value is string => Boolean(value));
  const contextValues = canExpandContext
    ? input.contextWindowOptions.map((contextWindow) => contextWindow.value)
    : [parameterContextWindow].filter((value): value is string => Boolean(value));
  const fastValues = canExpandFast ? [false, true] : [undefined];
  const variantDefaultEffort = parameterReasoningEffort ?? input.defaultReasoningEffort;
  const variantDefaultContextWindow = parameterContextWindow ?? input.defaultContextWindow;
  const descriptors: Array<ProviderModelDescriptor> = [];
  const seen = new Set<string>();

  for (const effort of reasoningValues.length > 0 ? reasoningValues : [undefined]) {
    for (const contextWindow of contextValues.length > 0 ? contextValues : [undefined]) {
      for (const fastMode of fastValues) {
        const variantParams = { ...params };
        if (reasoningKey && effort) {
          variantParams[reasoningKey] = cursorReasoningParameterValue(effort);
        }
        if (contextWindow) variantParams.context = contextWindow;
        if (fastMode !== undefined) variantParams.fast = String(fastMode);
        const slug = buildCursorParameterizedModelSlug(baseModel, variantParams);
        if (seen.has(slug)) continue;
        seen.add(slug);
        descriptors.push(
          buildCursorAcpModelDescriptor({
            choice: input.choice,
            slug,
            name: withCursorVariantName(
              input.choice.name,
              effort,
              variantDefaultEffort,
              contextWindow,
              variantDefaultContextWindow,
              input.contextWindowOptions,
              fastMode,
            ),
            supportedReasoningEfforts: [],
            contextWindowOptions: [],
          }),
        );
      }
    }
  }
  return descriptors;
}

export function buildCursorAcpModelDescriptors(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
): ReadonlyArray<ProviderModelDescriptor> {
  const choices = flattenCursorAcpModelChoices(configOptions);
  if (choices.length === 0) return [];
  const effortOption = findCursorEffortConfigOption(configOptions);
  const supportedReasoningEfforts =
    effortOption?.type === "select"
      ? flattenCursorSessionConfigSelectOptions(effortOption).flatMap((entry) => {
          const value = normalizeCursorReasoningValue(entry.value);
          return value ? [{ value, label: entry.name || value }] : [];
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
      ? flattenCursorSessionConfigSelectOptions(contextOption).map((entry) => ({
          value: entry.value,
          label: entry.name || entry.value,
          ...(contextOption.currentValue === entry.value ? { isDefault: true as const } : {}),
        }))
      : [];
  const defaultContextWindow = contextWindowOptions.find((option) => option.isDefault)?.value;
  const descriptors = choices.flatMap((choice) =>
    expandCursorParameterizedModelDescriptors({
      choice,
      supportedReasoningEfforts,
      ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
      contextWindowOptions,
      ...(defaultContextWindow ? { defaultContextWindow } : {}),
    }),
  );
  const seen = new Set<string>();
  return descriptors.filter((descriptor) => {
    if (seen.has(descriptor.slug)) return false;
    seen.add(descriptor.slug);
    return true;
  });
}
