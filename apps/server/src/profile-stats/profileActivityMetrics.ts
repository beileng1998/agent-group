import type { ProfileStats } from "@agent-group/contracts";

import type { HeatmapCell, PromptActivityRow } from "./profileStatsRows";
import { nonEmptyString, num } from "./profileStatsValues";

const HEATMAP_WINDOW_DAYS = 274;

function addDaysIso(day: string, delta: number): string {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date) + delta * 86_400_000).toISOString().slice(0, 10);
}

function weekdayOf(day: string): number {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
}

function heatmapIntensity(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function formatHour(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  if (normalized === 0) return "12 AM";
  if (normalized === 12) return "12 PM";
  return normalized < 12 ? `${normalized} AM` : `${normalized - 12} PM`;
}

function arcName(startHour: number): string {
  if (startHour < 5) return "Late-Night Dev Arc";
  if (startHour < 9) return "Early Bird Arc";
  if (startHour < 12) return "Morning Arc";
  if (startHour < 17) return "Afternoon Arc";
  if (startHour < 21) return "Evening Arc";
  return "Night Owl Arc";
}

function computeStreaks(
  activeDaysAsc: ReadonlyArray<string>,
  todayKey: string,
): { current: number; longest: number } {
  if (activeDaysAsc.length === 0) return { current: 0, longest: 0 };
  const set = new Set(activeDaysAsc);
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of activeDaysAsc) {
    run = previous && addDaysIso(previous, 1) === day ? run + 1 : 1;
    if (run > longest) longest = run;
    previous = day;
  }
  let anchor: string | null = set.has(todayKey)
    ? todayKey
    : set.has(addDaysIso(todayKey, -1))
      ? addDaysIso(todayKey, -1)
      : null;
  let current = 0;
  while (anchor && set.has(anchor)) {
    current += 1;
    anchor = addDaysIso(anchor, -1);
  }
  return { current, longest };
}

export function buildHeatmap(
  countByDay: ReadonlyMap<string, number>,
  todayKey: string,
): HeatmapCell[] {
  const windowStart = addDaysIso(todayKey, -(HEATMAP_WINDOW_DAYS - 1));
  let windowMax = 0;
  for (const [day, count] of countByDay) {
    if (day >= windowStart && day <= todayKey && count > windowMax) windowMax = count;
  }
  const heatmap: HeatmapCell[] = [];
  for (let offset = 0; offset < HEATMAP_WINDOW_DAYS; offset += 1) {
    const day = addDaysIso(windowStart, offset);
    const count = countByDay.get(day) ?? 0;
    heatmap.push({
      day,
      count,
      weekday: weekdayOf(day),
      intensity: heatmapIntensity(count, windowMax),
    });
  }
  return heatmap;
}

export function aggregatePromptActivity(
  rows: ReadonlyArray<PromptActivityRow>,
  todayKey: string,
): {
  countByDay: Map<string, number>;
  totalPromptsSent: number;
  currentStreakDays: number;
  longestStreakDays: number;
  heatmap: HeatmapCell[];
  activeHours: ProfileStats["activeHours"];
} {
  const countByDay = new Map<string, number>();
  const hourCounts = Array.from({ length: 24 }, () => 0);
  let totalPromptsSent = 0;
  for (const row of rows) {
    const day = nonEmptyString(row.day);
    const count = num(row.count);
    if (day) countByDay.set(day, (countByDay.get(day) ?? 0) + count);
    const hour = ((Math.trunc(num(row.hour)) % 24) + 24) % 24;
    hourCounts[hour] = (hourCounts[hour] ?? 0) + count;
    totalPromptsSent += count;
  }
  const activeDaysAsc = [...countByDay.entries()]
    .filter(([, count]) => count > 0)
    .map(([day]) => day)
    .toSorted();
  const streaks = computeStreaks(activeDaysAsc, todayKey);
  const totalHourTurns = hourCounts.reduce((sum, value) => sum + value, 0);
  let bestHour: number | null = null;
  let bestHourCount = 0;
  if (totalHourTurns > 0) {
    for (let hour = 0; hour < 24; hour += 1) {
      const hourCount = hourCounts[hour] ?? 0;
      if (hourCount > bestHourCount) {
        bestHourCount = hourCount;
        bestHour = hour;
      }
    }
  }
  return {
    countByDay,
    totalPromptsSent,
    currentStreakDays: streaks.current,
    longestStreakDays: streaks.longest,
    heatmap: buildHeatmap(countByDay, todayKey),
    activeHours:
      bestHour === null
        ? { startHour: null, endHour: null, turnCount: 0, label: null }
        : {
            startHour: bestHour,
            endHour: null,
            turnCount: bestHourCount,
            label: `${formatHour(bestHour)} · ${arcName(bestHour)}`,
          },
  };
}
