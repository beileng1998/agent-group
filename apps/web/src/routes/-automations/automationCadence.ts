// FILE: automationCadence.ts
// Purpose: Owns automation cadence and iteration menu options.
// Layer: Automation dialog model

import type { IntervalUnit } from "~/lib/automationForm";

export const AUTOMATION_CHIP_CLASS =
  "gap-1.5 rounded-lg px-2 font-normal text-[var(--color-text-foreground-secondary)]";

export type IntervalCadenceOption = {
  readonly amount: string;
  readonly unit: IntervalUnit;
  readonly label: string;
};

export const INTERVAL_PRESETS: readonly IntervalCadenceOption[] = [
  { amount: "15", unit: "minutes", label: "Every 15 min" },
  { amount: "30", unit: "minutes", label: "Every 30 min" },
  { amount: "120", unit: "minutes", label: "Every 2 hours" },
  { amount: "360", unit: "minutes", label: "Every 6 hours" },
  { amount: "720", unit: "minutes", label: "Every 12 hours" },
  { amount: "1440", unit: "minutes", label: "Every 24 hours" },
];

export function intervalOptionValue(
  option: Pick<IntervalCadenceOption, "amount" | "unit">,
): string {
  return `${option.unit}:${option.amount}`;
}

export function intervalOptionLabel(amount: string, unit: IntervalUnit): string {
  return unit === "seconds" ? `Every ${amount} sec` : `Every ${amount} min`;
}

const MAX_ITERATION_PRESETS: readonly { readonly value: string; readonly label: string }[] = [
  { value: "", label: "Unlimited" },
  { value: "10", label: "10 runs" },
  { value: "25", label: "25 runs" },
  { value: "50", label: "50 runs" },
  { value: "100", label: "100 runs" },
  { value: "250", label: "250 runs" },
];

export function maxIterationOptions(
  currentValue: string | number | null | undefined,
): readonly { readonly value: string; readonly label: string }[] {
  const value = currentValue == null ? "" : String(currentValue).trim();
  if (!/^\d+$/.test(value) || MAX_ITERATION_PRESETS.some((preset) => preset.value === value)) {
    return MAX_ITERATION_PRESETS;
  }
  return [{ value, label: value === "1" ? "1 run" : `${value} runs` }, ...MAX_ITERATION_PRESETS];
}
