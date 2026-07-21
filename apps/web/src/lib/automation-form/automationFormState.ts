import type {
  AutomationDefinition,
  AutomationSchedule,
  ModelSelection,
} from "@agent-group/contracts";

import { stopWhenFromCompletionPolicy } from "../automationCompletionPolicy";
import {
  datetimeLocalFromIso,
  isoFromDatetimeLocal,
  localTimezone,
  scheduleKindFromSchedule,
  scheduleTimezone,
} from "./automationSchedule";
import {
  defaultModelSelection,
  type AutomationFormState,
  type IntervalUnit,
} from "./automationFormTypes";

const LEGACY_WALL_CLOCK_TIMEZONE = "UTC";

function intervalFormPartsFromSeconds(everySeconds: number): {
  readonly amount: string;
  readonly unit: IntervalUnit;
} {
  return everySeconds >= 60 && everySeconds % 60 === 0
    ? { amount: String(everySeconds / 60), unit: "minutes" }
    : { amount: String(everySeconds), unit: "seconds" };
}

export function formFromDefinition(
  definition: AutomationDefinition | null,
  fallbackProjectId: string,
  fallbackModelSelection: ModelSelection = defaultModelSelection,
): AutomationFormState {
  const schedule = definition?.schedule ?? { type: "daily" as const, timeOfDay: "09:00" };
  const timezone = scheduleTimezone(
    schedule,
    definition ? LEGACY_WALL_CLOCK_TIMEZONE : localTimezone(),
  );
  return {
    name: definition?.name ?? "",
    projectId: definition?.projectId ?? fallbackProjectId,
    prompt: definition?.prompt ?? "",
    enabled: definition?.enabled ?? true,
    scheduleKind: scheduleKindFromSchedule(schedule),
    intervalAmount:
      schedule.type === "interval" && schedule.everySeconds !== 3600
        ? intervalFormPartsFromSeconds(schedule.everySeconds).amount
        : "30",
    intervalUnit:
      schedule.type === "interval" && schedule.everySeconds !== 3600
        ? intervalFormPartsFromSeconds(schedule.everySeconds).unit
        : "minutes",
    timeOfDay:
      schedule.type === "daily" || schedule.type === "weekly" || schedule.type === "weekdays"
        ? schedule.timeOfDay
        : "09:00",
    dayOfWeek: schedule.type === "weekly" ? String(schedule.dayOfWeek) : "1",
    onceRunAt:
      schedule.type === "once"
        ? datetimeLocalFromIso(schedule.runAt)
        : datetimeLocalFromIso(new Date(Date.now() + 15 * 60_000).toISOString()),
    cronExpression: schedule.type === "cron" ? schedule.expression : "0 9 * * *",
    timezone,
    runtimeMode: definition?.runtimeMode ?? "approval-required",
    worktreeMode: definition?.worktreeMode ?? "auto",
    modelSelection: definition?.modelSelection ?? fallbackModelSelection,
    mode: definition?.mode ?? "standalone",
    targetThreadId: definition?.targetThreadId ?? "",
    maxIterations: definition?.maxIterations != null ? String(definition.maxIterations) : "",
    stopOnError: definition?.stopOnError ?? true,
    stopWhen: definition
      ? stopWhenFromCompletionPolicy(definition.completionPolicy ?? { type: "none" })
      : "",
  };
}

export function applyScheduleToForm(
  form: AutomationFormState,
  schedule: AutomationSchedule,
  fallbackTimezone: string = localTimezone(),
): AutomationFormState {
  const timezone = scheduleTimezone(schedule, fallbackTimezone);
  return {
    ...form,
    scheduleKind: scheduleKindFromSchedule(schedule),
    intervalAmount:
      schedule.type === "interval" && schedule.everySeconds !== 3600
        ? intervalFormPartsFromSeconds(schedule.everySeconds).amount
        : form.intervalAmount,
    intervalUnit:
      schedule.type === "interval" && schedule.everySeconds !== 3600
        ? intervalFormPartsFromSeconds(schedule.everySeconds).unit
        : form.intervalUnit,
    timeOfDay:
      schedule.type === "daily" || schedule.type === "weekly" || schedule.type === "weekdays"
        ? schedule.timeOfDay
        : form.timeOfDay,
    dayOfWeek: schedule.type === "weekly" ? String(schedule.dayOfWeek) : form.dayOfWeek,
    onceRunAt: schedule.type === "once" ? datetimeLocalFromIso(schedule.runAt) : form.onceRunAt,
    cronExpression: schedule.type === "cron" ? schedule.expression : form.cronExpression,
    timezone,
  };
}

export function scheduleFromForm(form: AutomationFormState): AutomationSchedule {
  const timezone = form.timezone.trim();
  switch (form.scheduleKind) {
    case "hourly":
      return { type: "interval", everySeconds: 3600 };
    case "manual":
      return { type: "manual" };
    case "once":
      return { type: "once", runAt: isoFromDatetimeLocal(form.onceRunAt) };
    case "custom": {
      const amount = Math.max(1, Number.parseInt(form.intervalAmount, 10) || 1);
      return {
        type: "interval",
        everySeconds: form.intervalUnit === "seconds" ? amount : amount * 60,
      };
    }
    case "daily":
      return { type: "daily", timeOfDay: form.timeOfDay, timezone };
    case "weekdays":
      return { type: "weekdays", timeOfDay: form.timeOfDay, timezone };
    case "weekly": {
      const dayOfWeek = Math.min(6, Math.max(0, Number.parseInt(form.dayOfWeek, 10) || 0));
      return { type: "weekly", dayOfWeek, timeOfDay: form.timeOfDay, timezone };
    }
    case "cron":
      return {
        type: "cron",
        expression: form.cronExpression.trim() || "0 9 * * *",
        timezone,
      };
  }
}

export function maxIterationsFromForm(
  form: Pick<AutomationFormState, "maxIterations">,
): number | null {
  const trimmed = form.maxIterations.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return parsed > 0 ? parsed : null;
}
