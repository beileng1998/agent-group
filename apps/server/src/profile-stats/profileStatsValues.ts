import type { ProfileQuota, ProfileStats, ProviderKind } from "@agent-group/contracts";

import type { MostWorkedProjectRow } from "./profileStatsRows";

const PROVIDER_KINDS = new Set<ProviderKind>([
  "codex",
  "claudeAgent",
  "cursor",
  "antigravity",
  "grok",
  "droid",
  "kilo",
  "opencode",
  "pi",
]);

export function sqliteModifierFromUtcOffsetMinutes(offsetMinutes: number): string {
  const safe = Number.isFinite(offsetMinutes) ? Math.trunc(offsetMinutes) : 0;
  const sign = safe < 0 ? "-" : "+";
  const abs = Math.abs(safe);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

export function localToday(utcOffsetMinutes: number): string {
  return new Date(Date.now() + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function num(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function percent1(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

export function compareNullableText(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return (left ?? "").localeCompare(right ?? "");
}

export function deriveInitials(name: string): string {
  const parts = name.split(/[\s._-]+/u).filter((part) => part.length > 0);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase() || "AG";
  }
  const single = parts[0] ?? name;
  return (single.slice(0, 2) || "AG").toUpperCase();
}

export function sanitizeHandle(basename: string): string {
  const slug = basename.toLowerCase().replace(/[^a-z0-9_]/gu, "");
  return `@${slug || "agent_group"}`;
}

export function normalizeProviderKind(value: unknown): ProviderKind | "unknown" {
  const provider = nonEmptyString(value);
  return provider && PROVIDER_KINDS.has(provider as ProviderKind)
    ? (provider as ProviderKind)
    : "unknown";
}

export function emptyQuota(): ProfileQuota {
  return {
    status: "unavailable",
    provider: null,
    window: null,
    usedPercent: null,
    resetsAt: null,
    planName: null,
  };
}

export function buildMostWorkedProject(
  row: MostWorkedProjectRow | undefined,
): ProfileStats["mostWorkedProject"] {
  if (!row) return null;
  const projectId = nonEmptyString(row.projectId);
  const title = nonEmptyString(row.title);
  const workspaceRoot = nonEmptyString(row.workspaceRoot);
  const lastWorkedAt = nonEmptyString(row.lastWorkedAt);
  if (!projectId || !title || !workspaceRoot || !lastWorkedAt) return null;
  return {
    projectId,
    title,
    workspaceRoot,
    promptCount: num(row.promptCount),
    threadCount: num(row.threadCount),
    activeDays: num(row.activeDays),
    lastWorkedAt,
  };
}
