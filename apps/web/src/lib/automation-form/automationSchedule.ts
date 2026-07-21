import type { AutomationSchedule } from "@agent-group/contracts";

import type { ScheduleKind } from "./automationFormTypes";

export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function scheduleTimezone(schedule: AutomationSchedule, fallbackTimezone: string): string {
  return (
    (schedule.type === "daily" ||
    schedule.type === "weekly" ||
    schedule.type === "weekdays" ||
    schedule.type === "cron"
      ? schedule.timezone
      : undefined) ?? fallbackTimezone
  );
}

/** Pick the schedule option that represents a stored schedule (interval 1h reads as "Hourly"). */
export function scheduleKindFromSchedule(schedule: AutomationSchedule): ScheduleKind {
  switch (schedule.type) {
    case "daily":
      return "daily";
    case "weekdays":
      return "weekdays";
    case "weekly":
      return "weekly";
    case "interval":
      return schedule.everySeconds === 3600 ? "hourly" : "custom";
    case "manual":
      return "manual";
    case "once":
      return "once";
    case "cron":
      return "cron";
  }
}

/** Build a schedule for the chosen kind, reusing compatible fields from `current`. */
export function scheduleFromKind(
  kind: ScheduleKind,
  current: AutomationSchedule,
  fallbackTimezone: string = localTimezone(),
): AutomationSchedule {
  const timeOfDay =
    current.type === "daily" || current.type === "weekly" || current.type === "weekdays"
      ? current.timeOfDay
      : "09:00";
  const timezone = scheduleTimezone(current, fallbackTimezone);
  switch (kind) {
    case "manual":
      return { type: "manual" };
    case "once":
      return { type: "once", runAt: new Date(Date.now() + 15 * 60_000).toISOString() };
    case "hourly":
      return { type: "interval", everySeconds: 3600 };
    case "custom":
      return {
        type: "interval",
        everySeconds:
          current.type === "interval" && current.everySeconds !== 3600
            ? current.everySeconds
            : 1800,
      };
    case "daily":
      return { type: "daily", timeOfDay, timezone };
    case "weekdays":
      return { type: "weekdays", timeOfDay, timezone };
    case "weekly":
      return {
        type: "weekly",
        dayOfWeek: current.type === "weekly" ? current.dayOfWeek : 1,
        timeOfDay,
        timezone,
      };
    case "cron":
      return {
        type: "cron",
        expression: current.type === "cron" ? current.expression : "0 9 * * *",
        timezone,
      };
  }
}

export function datetimeLocalFromIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  const localIso = new Date(date.getTime() - offsetMs).toISOString();
  return localIso.slice(0, date.getSeconds() === 0 && date.getMilliseconds() === 0 ? 16 : 19);
}

export function isoFromDatetimeLocal(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? new Date(Date.now() + 15 * 60_000).toISOString()
    : date.toISOString();
}

export function updateWeeklyScheduleDay(
  schedule: Extract<AutomationSchedule, { type: "weekly" }>,
  dayOfWeek: number,
): AutomationSchedule {
  return { ...schedule, dayOfWeek };
}

export function updateWeeklyScheduleTime(
  schedule: Extract<AutomationSchedule, { type: "weekly" }>,
  timeOfDay: string,
): AutomationSchedule {
  return { ...schedule, timeOfDay };
}

export function formatDateTime(value: string | null): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)}`;
}

function timezoneSuffix(schedule: AutomationSchedule): string {
  if (
    (schedule.type === "daily" ||
      schedule.type === "weekdays" ||
      schedule.type === "weekly" ||
      schedule.type === "cron") &&
    schedule.timezone
  ) {
    return ` ${schedule.timezone}`;
  }
  return " UTC";
}

function formatIntervalSchedule(seconds: number): string {
  return seconds % 60 === 0 ? `Every ${seconds / 60} min` : `Every ${seconds} sec`;
}

function formatIntervalCadence(seconds: number): string {
  if (seconds === 3600) return "Hourly";
  if (seconds % 3600 === 0) return `Every ${seconds / 3600}h`;
  if (seconds % 60 === 0) return `Every ${seconds / 60}m`;
  return `Every ${seconds}s`;
}

export function formatSchedule(schedule: AutomationSchedule): string {
  switch (schedule.type) {
    case "manual":
      return "Manual";
    case "once":
      return `Once ${formatDateTime(schedule.runAt)}`;
    case "interval":
      return formatIntervalSchedule(schedule.everySeconds);
    case "daily":
      return `Daily ${schedule.timeOfDay}${timezoneSuffix(schedule)}`;
    case "weekdays":
      return `Weekdays ${schedule.timeOfDay}${timezoneSuffix(schedule)}`;
    case "weekly":
      return `Weekly ${weekdayLabel(schedule.dayOfWeek)} ${schedule.timeOfDay}${timezoneSuffix(schedule)}`;
    case "cron":
      return `Cron ${schedule.expression} ${schedule.timezone}`;
  }
}

/** "09:00" -> "9:00": drops the leading zero on the hour. */
export function formatClockTime(timeOfDay: string): string {
  const [hours, minutes] = timeOfDay.split(":");
  const hour = Number.parseInt(hours ?? "", 10);
  if (Number.isNaN(hour)) return timeOfDay;
  return `${hour}:${minutes ?? "00"}`;
}

export function formatCadence(schedule: AutomationSchedule): string {
  switch (schedule.type) {
    case "manual":
      return "Manual";
    case "once":
      return formatDateTime(schedule.runAt);
    case "interval":
      return formatIntervalCadence(schedule.everySeconds);
    case "daily":
      return `Daily at ${formatClockTime(schedule.timeOfDay)}`;
    case "weekdays":
      return `Weekdays at ${formatClockTime(schedule.timeOfDay)}`;
    case "weekly":
      return `${weekdayLabel(schedule.dayOfWeek)} at ${formatClockTime(schedule.timeOfDay)}`;
    case "cron":
      return `Cron ${schedule.expression}`;
  }
}

export function weekdayLabel(value: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][value] ?? "Sun";
}
