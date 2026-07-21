import type { AutomationDefinition, AutomationRun } from "@agent-group/contracts";

import { automationLifecycleState } from "~/lib/automationStatus";

export type SelectOption = { readonly value: string; readonly label: string };

export const WORKTREE_OPTIONS: readonly SelectOption[] = [
  { value: "auto", label: "Auto" },
  { value: "local", label: "Local" },
  { value: "worktree", label: "Worktree" },
];

export const INTERVAL_PRESETS: readonly SelectOption[] = [
  { value: "900", label: "Every 15 min" },
  { value: "1800", label: "Every 30 min" },
  { value: "3600", label: "Every hour" },
  { value: "7200", label: "Every 2 hours" },
  { value: "21600", label: "Every 6 hours" },
  { value: "43200", label: "Every 12 hours" },
  { value: "86400", label: "Every 24 hours" },
];

export function intervalOptions(current: number): readonly SelectOption[] {
  if (INTERVAL_PRESETS.some((option) => option.value === String(current))) {
    return INTERVAL_PRESETS;
  }
  const label =
    current >= 60 && current % 60 === 0 ? `Every ${current / 60} min` : `Every ${current} sec`;
  return [{ value: String(current), label }, ...INTERVAL_PRESETS];
}

export function lastFinishedRun(runs: readonly AutomationRun[]): AutomationRun | null {
  return runs.find((run) => run.finishedAt != null || run.startedAt != null) ?? null;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatRunTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  const dayDelta = Math.round((startOfDay(date) - startOfDay(new Date())) / 86_400_000);
  if (dayDelta === 0) return `Today at ${time}`;
  if (dayDelta === 1) return `Tomorrow at ${time}`;
  if (dayDelta === -1) return `Yesterday at ${time}`;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function automationStatusDisplay(definition: AutomationDefinition): {
  readonly label: string;
  readonly dotClassName: string;
} {
  switch (automationLifecycleState(definition)) {
    case "active":
      return { label: "Active", dotClassName: "bg-emerald-500" };
    case "paused":
      return { label: "Paused", dotClassName: "bg-amber-500" };
    case "scheduled":
      return { label: "Scheduled", dotClassName: "bg-sky-500" };
    case "done":
      return { label: "Done", dotClassName: "bg-muted-foreground" };
  }
}
