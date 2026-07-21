import type { AutomationSchedule } from "@agent-group/contracts";

import {
  BARE_INTERVAL_LEADING_REMAINDER_PATTERN,
  BARE_INTERVAL_UNIT_PATTERN,
  CRON_FIELD_PATTERN,
  DEFAULT_DAILY_TIME,
  INTERVAL_PATTERN,
  TIME_PATTERN,
  WEEKDAY_BY_TOKEN,
} from "./constants";
import type { ParsedSchedule } from "./types";

function parseTimeOfDay(value: string | undefined): string | null {
  const match = /^([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm)?$/i.exec(value?.trim() ?? "");
  if (!match) {
    return null;
  }
  const meridiem = match[3]?.toLowerCase();
  const hour = Number.parseInt(match[1] ?? "", 10);
  const minute = Number.parseInt(match[2] ?? "0", 10);
  if (Number.isNaN(hour) || (meridiem && hour > 12)) {
    return null;
  }
  const safeHour =
    meridiem === "pm" && hour < 12 ? hour + 12 : meridiem === "am" && hour === 12 ? 0 : hour;
  const safeMinute = Number.isNaN(minute) ? 0 : Math.min(59, Math.max(0, minute));
  return `${String(safeHour).padStart(2, "0")}:${String(safeMinute).padStart(2, "0")}`;
}

function intervalUnitToSeconds(unit: string): number {
  if (
    unit === "s" ||
    unit === "sec" ||
    unit === "secs" ||
    unit === "second" ||
    unit === "seconds" ||
    unit === "secondo" ||
    unit === "secondi"
  ) {
    return 1;
  }
  if (
    unit === "m" ||
    unit === "min" ||
    unit === "mins" ||
    unit === "minute" ||
    unit === "minutes" ||
    unit === "minuto" ||
    unit === "minuti"
  ) {
    return 60;
  }
  if (
    unit === "h" ||
    unit === "hr" ||
    unit === "hrs" ||
    unit === "hour" ||
    unit === "hours" ||
    unit === "ora" ||
    unit === "ore"
  ) {
    return 3600;
  }
  return 86_400;
}

function intervalUnitLabel(unit: string): "s" | "m" | "h" | "d" {
  const seconds = intervalUnitToSeconds(unit);
  if (seconds === 1) return "s";
  if (seconds === 60) return "m";
  if (seconds === 3600) return "h";
  return "d";
}

export function formatAutomationIntentCadence(schedule: AutomationSchedule): string {
  if (schedule.type === "interval") {
    const seconds = schedule.everySeconds;
    if (seconds % 86_400 === 0) return `Every ${seconds / 86_400}d`;
    if (seconds % 3_600 === 0) return `Every ${seconds / 3_600}h`;
    if (seconds % 60 === 0) return `Every ${seconds / 60}m`;
    return `Every ${seconds}s`;
  }
  if (schedule.type === "once") {
    return `Once at ${new Date(schedule.runAt).toLocaleString()}`;
  }
  if (schedule.type === "cron") {
    return `Cron ${schedule.expression}`;
  }
  if (schedule.type === "daily") {
    return `Daily at ${schedule.timeOfDay}`;
  }
  if (schedule.type === "weekdays") {
    return `Weekdays at ${schedule.timeOfDay}`;
  }
  if (schedule.type === "weekly") {
    return `Weekly at ${schedule.timeOfDay}`;
  }
  return "Manual";
}

function parseIntervalSchedule(searchText: string): ParsedSchedule | null {
  const match =
    searchText.match(new RegExp(`\\b(?:every|each)\\s+${INTERVAL_PATTERN}\\b`)) ??
    searchText.match(new RegExp(`\\bogni\\s+${INTERVAL_PATTERN}\\b`));
  const bareMatch =
    match == null
      ? (searchText.match(
          new RegExp(
            `^(?:every|each)\\s+(${BARE_INTERVAL_UNIT_PATTERN})\\b${BARE_INTERVAL_LEADING_REMAINDER_PATTERN}`,
          ),
        ) ??
        searchText.match(new RegExp(`\\b(?:every|each)\\s+(${BARE_INTERVAL_UNIT_PATTERN})$`)) ??
        searchText.match(
          new RegExp(
            `^ogni\\s+(${BARE_INTERVAL_UNIT_PATTERN})\\b${BARE_INTERVAL_LEADING_REMAINDER_PATTERN}`,
          ),
        ) ??
        searchText.match(new RegExp(`\\bogni\\s+(${BARE_INTERVAL_UNIT_PATTERN})$`)))
      : null;
  if (!match && !bareMatch) {
    return null;
  }

  const amount = match ? Number.parseInt(match[1] ?? "", 10) : 1;
  const unit = match?.[2] ?? bareMatch?.[1] ?? "m";
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const everySeconds = amount * intervalUnitToSeconds(unit);
  const schedule = {
    type: "interval",
    everySeconds,
  } as const;
  return {
    schedule,
    cadenceLabel: `Every ${amount}${intervalUnitLabel(unit)}`,
  };
}

function parseOnceSchedule(searchText: string, nowIso: string): ParsedSchedule | null {
  const match =
    searchText.match(new RegExp(`\\bin\\s+${INTERVAL_PATTERN}\\b`)) ??
    searchText.match(new RegExp(`\\b(?:tra|fra)\\s+${INTERVAL_PATTERN}\\b`));
  if (!match) {
    return null;
  }

  const amount = Number.parseInt(match[1] ?? "", 10);
  const unit = match[2] ?? "m";
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const delaySeconds = amount * intervalUnitToSeconds(unit);
  if (delaySeconds < 5) {
    return null;
  }
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) {
    return null;
  }
  const runAt = new Date(now.getTime() + delaySeconds * 1000).toISOString();
  return {
    schedule: { type: "once", runAt },
    cadenceLabel: `In ${amount}${intervalUnitLabel(unit)}`,
  };
}

function parseCronSchedule(searchText: string): ParsedSchedule | null {
  const match = searchText.match(
    new RegExp(
      `\\bcron\\s+(${CRON_FIELD_PATTERN}\\s+${CRON_FIELD_PATTERN}\\s+${CRON_FIELD_PATTERN}\\s+${CRON_FIELD_PATTERN}\\s+${CRON_FIELD_PATTERN})(?=\\s|$)`,
    ),
  );
  if (!match?.[1]) {
    return null;
  }
  const expression = match[1].trim();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return {
    schedule: { type: "cron", expression, timezone },
    cadenceLabel: `Cron ${expression}`,
  };
}

function parseDailySchedule(searchText: string): ParsedSchedule | null {
  const timedDailyMatch =
    searchText.match(new RegExp(`\\b(?:daily|every day)\\s+at\\s+${TIME_PATTERN}\\b`)) ??
    searchText.match(
      new RegExp(`\\b(?:ogni giorno|tutti i giorni)\\s+(?:alle|a)\\s+${TIME_PATTERN}\\b`),
    );
  if (timedDailyMatch) {
    const timeOfDay = parseTimeOfDay(timedDailyMatch[1]);
    return timeOfDay
      ? {
          schedule: { type: "daily", timeOfDay },
          cadenceLabel: `Daily at ${timeOfDay}`,
        }
      : null;
  }

  if (
    /\b(?:daily|every day)\s+at\b/.test(searchText) ||
    /\b(?:ogni giorno|tutti i giorni)\s+(?:alle|a)\b/.test(searchText)
  ) {
    return null;
  }

  const dailyMatch =
    searchText.match(/\b(?:daily|every day)\b/) ??
    searchText.match(/\b(?:ogni giorno|tutti i giorni)\b/);
  if (!dailyMatch) {
    return null;
  }

  const timeOfDay = DEFAULT_DAILY_TIME;
  return {
    schedule: { type: "daily", timeOfDay },
    cadenceLabel: `Daily at ${timeOfDay}`,
  };
}

function parseWeekdaysSchedule(searchText: string): ParsedSchedule | null {
  const timedWeekdaysMatch =
    searchText.match(
      new RegExp(`\\b(?:weekdays|every weekday|workdays)\\s+at\\s+${TIME_PATTERN}\\b`),
    ) ??
    searchText.match(
      new RegExp(
        `\\b(?:giorni lavorativi|ogni giorno lavorativo)\\s+(?:alle|a)\\s+${TIME_PATTERN}\\b`,
      ),
    );
  if (timedWeekdaysMatch) {
    const timeOfDay = parseTimeOfDay(timedWeekdaysMatch[1]);
    return timeOfDay
      ? {
          schedule: { type: "weekdays", timeOfDay },
          cadenceLabel: `Weekdays at ${timeOfDay}`,
        }
      : null;
  }

  if (
    /\b(?:weekdays|every weekday|workdays)\s+at\b/.test(searchText) ||
    /\b(?:giorni lavorativi|ogni giorno lavorativo)\s+(?:alle|a)\b/.test(searchText)
  ) {
    return null;
  }

  const weekdaysMatch =
    searchText.match(/\b(?:weekdays|every weekday|workdays)\b/) ??
    searchText.match(/\b(?:giorni lavorativi|ogni giorno lavorativo)\b/);
  if (!weekdaysMatch) {
    return null;
  }

  const timeOfDay = DEFAULT_DAILY_TIME;
  return {
    schedule: { type: "weekdays", timeOfDay },
    cadenceLabel: `Weekdays at ${timeOfDay}`,
  };
}

function parseWeeklySchedule(searchText: string): ParsedSchedule | null {
  const weekdayTokens = Object.keys(WEEKDAY_BY_TOKEN).join("|");
  const timedWeeklyMatch =
    searchText.match(new RegExp(`\\bevery\\s+(${weekdayTokens})\\s+at\\s+${TIME_PATTERN}\\b`)) ??
    searchText.match(
      new RegExp(`\\bogni\\s+(${weekdayTokens})\\s+(?:alle|a)\\s+${TIME_PATTERN}\\b`),
    );
  if (timedWeeklyMatch) {
    const dayOfWeek = WEEKDAY_BY_TOKEN[timedWeeklyMatch[1] ?? ""];
    const timeOfDay = parseTimeOfDay(timedWeeklyMatch[2]);
    return dayOfWeek !== undefined && timeOfDay
      ? {
          schedule: { type: "weekly", dayOfWeek, timeOfDay },
          cadenceLabel: `Weekly at ${timeOfDay}`,
        }
      : null;
  }

  if (
    new RegExp(`\\bevery\\s+(?:${weekdayTokens})\\s+at\\b`).test(searchText) ||
    new RegExp(`\\bogni\\s+(?:${weekdayTokens})\\s+(?:alle|a)\\b`).test(searchText)
  ) {
    return null;
  }

  const weeklyMatch =
    searchText.match(new RegExp(`\\bevery\\s+(${weekdayTokens})\\b`)) ??
    searchText.match(new RegExp(`\\bogni\\s+(${weekdayTokens})\\b`));
  if (!weeklyMatch) {
    return null;
  }

  const dayOfWeek = WEEKDAY_BY_TOKEN[weeklyMatch[1] ?? ""];
  if (dayOfWeek === undefined) {
    return null;
  }

  const timeOfDay = DEFAULT_DAILY_TIME;
  return {
    schedule: { type: "weekly", dayOfWeek, timeOfDay },
    cadenceLabel: `Weekly at ${timeOfDay}`,
  };
}

export function parseSchedule(searchText: string, nowIso: string): ParsedSchedule | null {
  if (/\b(?:between|around|circa|verso)\b/.test(searchText)) {
    return null;
  }
  return (
    parseCronSchedule(searchText) ??
    parseOnceSchedule(searchText, nowIso) ??
    parseIntervalSchedule(searchText) ??
    parseWeekdaysSchedule(searchText) ??
    parseWeeklySchedule(searchText) ??
    parseDailySchedule(searchText)
  );
}
