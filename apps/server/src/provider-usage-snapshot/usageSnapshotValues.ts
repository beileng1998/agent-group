import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";

import type {
  ServerGetProviderUsageSnapshotResult,
  ServerProviderUsageLimit,
  ServerProviderUsageLine,
} from "@agent-group/contracts";

export const LOOKBACK_DAYS = 30;
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const LOOKBACK_7D_MS = 7 * ONE_DAY_MS;
export const LOOKBACK_30D_MS = LOOKBACK_DAYS * ONE_DAY_MS;
export const MAX_RECENT_USAGE_FILES = 2_000;
export const PROVIDER_USAGE_FILE_READ_CONCURRENCY = 16;

export type UsageSnapshot = Exclude<ServerGetProviderUsageSnapshotResult, null>;

export interface CodexSessionSummary {
  timestampMs: number;
  totalTokens: number;
  limits: ReadonlyArray<ServerProviderUsageLimit>;
}

export interface ClaudeUsageSample {
  sessionId: string;
  timestampMs: number;
  totalTokens: number;
  model: string | null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asNonNegativeNumber(value: unknown): number | undefined {
  const parsed = asFiniteNumber(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

export function toIsoString(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function formatCompactNumber(value: number): string {
  const absoluteValue = Math.abs(value);
  if (absoluteValue < 1_000) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
  }
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: absoluteValue < 1_000_000 ? 1 : 0,
  }).format(value);
}

function formatRecentSessionsSubtitle(sessionCount: number): string | undefined {
  if (sessionCount <= 0) return undefined;
  return `${new Intl.NumberFormat(undefined).format(sessionCount)} recent ${sessionCount === 1 ? "session" : "sessions"}`;
}

export async function safeReadDir(path: string): Promise<ReadonlyArray<Dirent>> {
  try {
    return await fs.readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function safeStat(path: string): Promise<Stats | null> {
  try {
    return await fs.stat(path);
  } catch {
    return null;
  }
}

export async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: Array<{ index: number; value: R }> = [];
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        const item = items[index];
        if (item !== undefined) results.push({ index, value: await mapper(item) });
      }
    }),
  );
  return results.toSorted((left, right) => left.index - right.index).map((entry) => entry.value);
}

export async function listRecentFiles(
  paths: ReadonlyArray<string>,
  maxFiles: number = MAX_RECENT_USAGE_FILES,
): Promise<ReadonlyArray<string>> {
  const filesWithStats = await mapWithConcurrency(
    paths,
    PROVIDER_USAGE_FILE_READ_CONCURRENCY,
    async (path) => ({ path, mtimeMs: (await safeStat(path))?.mtimeMs ?? 0 }),
  );
  return filesWithStats
    .toSorted((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, maxFiles)
    .map((entry) => entry.path);
}

export function buildUsageLines(input: {
  tokens24h: number;
  tokens7d: number;
  tokens30d: number;
  sessions24h: number;
  sessions7d: number;
  sessions30d: number;
}): ReadonlyArray<ServerProviderUsageLine> {
  const line = (label: string, tokens: number, sessions: number): ServerProviderUsageLine => {
    const subtitle = formatRecentSessionsSubtitle(sessions);
    return {
      label,
      value: `${formatCompactNumber(tokens)} tokens`,
      ...(subtitle ? { subtitle } : {}),
    };
  };
  return [
    line("24h", input.tokens24h, input.sessions24h),
    line("7d", input.tokens7d, input.sessions7d),
    line("30d", input.tokens30d, input.sessions30d),
  ];
}
