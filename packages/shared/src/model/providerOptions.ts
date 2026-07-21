import {
  type ModelCapabilities,
  type ModelSelection,
  type ProviderKind,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
} from "@agent-group/contracts";
import { trimOrNull } from "./modelSlugs";

type ProviderOptionSelectionsInput =
  | ReadonlyArray<ProviderOptionSelection>
  | Record<string, unknown>
  | null
  | undefined;

function cloneProviderOptionDescriptor(
  descriptor: ProviderOptionDescriptor,
): ProviderOptionDescriptor {
  if (descriptor.type === "select") {
    return {
      ...descriptor,
      options: descriptor.options.map((option) => ({ ...option })),
      ...(descriptor.promptInjectedValues
        ? { promptInjectedValues: [...descriptor.promptInjectedValues] }
        : {}),
    };
  }
  return { ...descriptor };
}

function providerOptionSelectionValue(
  selections: ProviderOptionSelectionsInput,
  id: string,
): string | boolean | undefined {
  if (!selections) {
    return undefined;
  }
  if (Array.isArray(selections)) {
    return selections.find((selection) => selection.id === id)?.value;
  }
  const selectionRecord = selections as Record<string, unknown>;
  const value = selectionRecord[id];
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" || typeof value === "boolean" ? value : undefined;
}

export function getProviderOptionSelectionValue(
  selections: ProviderOptionSelectionsInput,
  id: string,
): string | boolean | undefined {
  return providerOptionSelectionValue(selections, id);
}

export function getProviderOptionStringSelectionValue(
  selections: ProviderOptionSelectionsInput,
  id: string,
): string | undefined {
  const value = getProviderOptionSelectionValue(selections, id);
  return typeof value === "string" ? value : undefined;
}

export function getProviderOptionBooleanSelectionValue(
  selections: ProviderOptionSelectionsInput,
  id: string,
): boolean | undefined {
  const value = getProviderOptionSelectionValue(selections, id);
  return typeof value === "boolean" ? value : undefined;
}

export function getModelSelectionOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): string | boolean | undefined {
  return getProviderOptionSelectionValue(
    modelSelection?.options as ProviderOptionSelectionsInput,
    id,
  );
}

export function getModelSelectionStringOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): string | undefined {
  return getProviderOptionStringSelectionValue(
    modelSelection?.options as ProviderOptionSelectionsInput,
    id,
  );
}

export function getModelSelectionBooleanOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): boolean | undefined {
  return getProviderOptionBooleanSelectionValue(
    modelSelection?.options as ProviderOptionSelectionsInput,
    id,
  );
}

function resolveDescriptorChoiceValue(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
  rawValue: string | null | undefined,
): string | undefined {
  const trimmed = trimOrNull(rawValue);
  if (trimmed && descriptor.options.some((option) => option.id === trimmed)) {
    return trimmed;
  }
  return descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id;
}

function withProviderOptionCurrentValue(
  descriptor: ProviderOptionDescriptor,
  rawValue: string | boolean | undefined,
): ProviderOptionDescriptor {
  if (descriptor.type === "boolean") {
    return typeof rawValue === "boolean" ? { ...descriptor, currentValue: rawValue } : descriptor;
  }
  const currentValue =
    typeof rawValue === "string"
      ? resolveDescriptorChoiceValue(descriptor, rawValue)
      : resolveDescriptorChoiceValue(descriptor, descriptor.currentValue);
  if (!currentValue) {
    const { currentValue: _currentValue, ...rest } = descriptor;
    return rest;
  }
  return { ...descriptor, currentValue };
}

function reasoningDescriptorId(provider: ProviderKind): string {
  if (provider === "claudeAgent") {
    return "effort";
  }
  if (provider === "kilo" || provider === "opencode") {
    return "variant";
  }
  if (provider === "pi") {
    return "thinkingLevel";
  }
  return "reasoningEffort";
}

function legacyCapabilityDescriptors(
  provider: ProviderKind,
  caps: ModelCapabilities,
): ProviderOptionDescriptor[] {
  const primaryOptions =
    provider === "kilo" || provider === "opencode"
      ? (caps.variantOptions ?? [])
      : caps.reasoningEffortLevels;
  const descriptors: ProviderOptionDescriptor[] = [];
  if (primaryOptions.length > 0) {
    const defaultPrimaryOption = primaryOptions.find((option) => option.isDefault);
    descriptors.push({
      id: reasoningDescriptorId(provider),
      label: provider === "kilo" || provider === "opencode" ? "Variant" : "Reasoning",
      type: "select",
      options: primaryOptions.map((option) => ({
        id: option.value,
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
        ...(option.isDefault ? { isDefault: true as const } : {}),
      })),
      ...(defaultPrimaryOption ? { currentValue: defaultPrimaryOption.value } : {}),
      ...(caps.promptInjectedEffortLevels.length > 0
        ? { promptInjectedValues: [...caps.promptInjectedEffortLevels] }
        : {}),
    });
  }
  if (caps.contextWindowOptions.length > 0) {
    const defaultContextWindowOption = caps.contextWindowOptions.find((option) => option.isDefault);
    descriptors.push({
      id: "contextWindow",
      label: "Context Window",
      type: "select",
      options: caps.contextWindowOptions.map((option) => ({
        id: option.value,
        label: option.label,
        ...(option.isDefault ? { isDefault: true as const } : {}),
      })),
      ...(defaultContextWindowOption ? { currentValue: defaultContextWindowOption.value } : {}),
    });
  }
  if (caps.autoCompactWindowOptions && caps.autoCompactWindowOptions.length > 0) {
    const defaultOption = caps.autoCompactWindowOptions.find((option) => option.isDefault);
    descriptors.push({
      id: "autoCompactWindow",
      label: "Auto-compact",
      type: "select",
      options: caps.autoCompactWindowOptions.map((option) => ({
        id: option.value,
        label: option.label,
        ...(option.isDefault ? { isDefault: true as const } : {}),
      })),
      ...(defaultOption ? { currentValue: defaultOption.value } : {}),
    });
  }
  if (caps.supportsFastMode) {
    descriptors.push({ id: "fastMode", label: "Fast Mode", type: "boolean" });
  }
  if (caps.supportsThinkingToggle) {
    descriptors.push({ id: "thinking", label: "Thinking", type: "boolean", currentValue: true });
  }
  return descriptors;
}

export function getProviderOptionDescriptors(input: {
  provider: ProviderKind;
  caps: ModelCapabilities;
  selections?: ProviderOptionSelectionsInput;
}): ReadonlyArray<ProviderOptionDescriptor> {
  const descriptors =
    input.caps.optionDescriptors?.map(cloneProviderOptionDescriptor) ??
    legacyCapabilityDescriptors(input.provider, input.caps);
  return descriptors.map((descriptor) =>
    withProviderOptionCurrentValue(
      descriptor,
      getProviderOptionSelectionValue(input.selections, descriptor.id),
    ),
  );
}

export function getProviderOptionCurrentValue(
  descriptor: ProviderOptionDescriptor | null | undefined,
): string | boolean | undefined {
  if (!descriptor) {
    return undefined;
  }
  if (descriptor.type === "boolean") {
    return descriptor.currentValue;
  }
  return descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id;
}

export function getProviderOptionCurrentLabel(
  descriptor: ProviderOptionDescriptor | null | undefined,
): string | undefined {
  const value = getProviderOptionCurrentValue(descriptor);
  if (!descriptor) {
    return undefined;
  }
  if (descriptor.type === "boolean") {
    return typeof value === "boolean" ? (value ? "On" : "Off") : undefined;
  }
  return typeof value === "string"
    ? descriptor.options.find((option) => option.id === value)?.label
    : undefined;
}

export function buildProviderOptionSelectionsFromDescriptors(
  descriptors: ReadonlyArray<ProviderOptionDescriptor> | null | undefined,
): ProviderOptionSelection[] | undefined {
  if (!descriptors || descriptors.length === 0) {
    return undefined;
  }
  const selections = descriptors.flatMap((descriptor) => {
    const value = getProviderOptionCurrentValue(descriptor);
    return typeof value === "string" || typeof value === "boolean"
      ? [{ id: descriptor.id, value }]
      : [];
  });
  return selections.length > 0 ? selections : undefined;
}
