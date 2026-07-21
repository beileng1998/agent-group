import type {
  AutomationMode,
  AutomationWorktreeMode,
  ModelSelection,
  RuntimeMode,
} from "@agent-group/contracts";

export const defaultModelSelection: ModelSelection = {
  provider: "codex",
  model: "gpt-5-codex",
};

export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** UI-level cadence options shown in the schedule picker. */
export type ScheduleKind =
  | "manual"
  | "once"
  | "hourly"
  | "daily"
  | "weekdays"
  | "weekly"
  | "custom"
  | "cron";

export type IntervalUnit = "seconds" | "minutes";

export const SCHEDULE_KIND_OPTIONS: readonly { value: ScheduleKind; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "once", label: "Once" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "custom", label: "Custom" },
  { value: "cron", label: "Cron" },
];

export type AutomationFormState = {
  readonly name: string;
  readonly projectId: string;
  readonly prompt: string;
  readonly enabled: boolean;
  readonly scheduleKind: ScheduleKind;
  readonly intervalAmount: string;
  readonly intervalUnit: IntervalUnit;
  readonly timeOfDay: string;
  readonly dayOfWeek: string;
  readonly onceRunAt: string;
  readonly cronExpression: string;
  readonly timezone: string;
  readonly runtimeMode: RuntimeMode;
  readonly worktreeMode: AutomationWorktreeMode;
  readonly modelSelection: ModelSelection;
  readonly mode: AutomationMode;
  readonly targetThreadId: string;
  readonly maxIterations: string;
  readonly stopOnError: boolean;
  readonly stopWhen: string;
};

export type AutomationProjectModelSelectionSource = {
  readonly id: string;
  readonly defaultModelSelection?: ModelSelection | null;
};
