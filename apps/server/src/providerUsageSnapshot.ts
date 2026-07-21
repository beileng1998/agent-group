// FILE: providerUsageSnapshot.ts
// Purpose: Read provider-specific local usage archives for recent usage snapshots.

import fs from "node:fs/promises";
import nodePath from "node:path";

import type {
  ProviderKind,
  ServerGetProviderUsageSnapshotInput,
  ServerGetProviderUsageSnapshotResult,
  ServerProviderUsageLine,
} from "@agent-group/contracts";
import { Effect } from "effect";

import { ServerConfig } from "./config";
import {
  normalizeCodexUsageLimits,
  readCodexTotalTokens,
} from "./provider-usage-snapshot/codexUsageValues";
import {
  asNonNegativeNumber,
  asRecord,
  asString,
  buildUsageLines,
  type ClaudeUsageSample,
  type CodexSessionSummary,
  listRecentFiles,
  LOOKBACK_30D_MS,
  LOOKBACK_7D_MS,
  LOOKBACK_DAYS,
  mapWithConcurrency,
  MAX_RECENT_USAGE_FILES,
  ONE_DAY_MS,
  parseTimestampMs,
  PROVIDER_USAGE_FILE_READ_CONCURRENCY,
  safeReadDir,
  toIsoString,
  type UsageSnapshot,
} from "./provider-usage-snapshot/usageSnapshotValues";

const USAGE_CACHE_TTL_MS = 30_000;

interface CachedUsageSnapshot {
  expiresAtMs: number;
  value: ServerGetProviderUsageSnapshotResult;
  pending: Promise<ServerGetProviderUsageSnapshotResult> | null;
}

const usageSnapshotCache = new Map<string, CachedUsageSnapshot>();

async function listRecentCodexSessionFiles(sessionsRoot: string): Promise<ReadonlyArray<string>> {
  const now = new Date();
  const candidates: string[] = [];

  for (let offset = 0; offset <= LOOKBACK_DAYS; offset += 1) {
    const current = new Date(now);
    current.setDate(now.getDate() - offset);
    const dayDir = nodePath.join(
      sessionsRoot,
      `${current.getFullYear()}`,
      `${String(current.getMonth() + 1).padStart(2, "0")}`,
      `${String(current.getDate()).padStart(2, "0")}`,
    );
    const entries = await safeReadDir(dayDir);
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        candidates.push(nodePath.join(dayDir, entry.name));
      }
    }
  }

  return listRecentFiles(candidates);
}

async function readCodexSessionSummary(path: string): Promise<CodexSessionSummary | null> {
  let fileContents: string;
  try {
    fileContents = await fs.readFile(path, "utf8");
  } catch {
    return null;
  }

  const lines = fileContents.split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line || !line.trim()) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const record = asRecord(parsed);
    if (!record || record.type !== "event_msg") {
      continue;
    }

    const payload = asRecord(record.payload);
    if (!payload || payload.type !== "token_count") {
      continue;
    }

    const timestampMs = parseTimestampMs(record.timestamp ?? payload.timestamp);
    if (timestampMs === null) {
      continue;
    }

    const summary = {
      timestampMs,
      totalTokens: readCodexTotalTokens(payload),
      limits: normalizeCodexUsageLimits(payload.rate_limits ?? payload.rateLimits),
    } satisfies CodexSessionSummary;

    // Codex session JSONL is chronological; only the final token_count event is
    // needed for lifetime accounting and the latest quota snapshot per file.
    return summary;
  }

  return null;
}

function readClaudeTotalTokens(value: unknown): number {
  const usage = asRecord(value);
  if (!usage) {
    return 0;
  }

  const inputTokens =
    (asNonNegativeNumber(usage.input_tokens) ?? 0) +
    (asNonNegativeNumber(usage.cache_creation_input_tokens) ?? 0) +
    (asNonNegativeNumber(usage.cache_read_input_tokens) ?? 0);
  const outputTokens = asNonNegativeNumber(usage.output_tokens) ?? 0;
  return asNonNegativeNumber(usage.total_tokens) ?? inputTokens + outputTokens;
}

function readClaudeAssistantSample(input: {
  record: Record<string, unknown>;
  fallbackKey: string;
}): { dedupeKey: string; sample: ClaudeUsageSample } | null {
  if (input.record.type !== "assistant") {
    return null;
  }

  const message = asRecord(input.record.message);
  const usage = asRecord(message?.usage);
  const totalTokens = readClaudeTotalTokens(usage);
  const timestampMs = parseTimestampMs(input.record.timestamp);
  if (!usage || totalTokens <= 0 || timestampMs === null) {
    return null;
  }

  const sessionId = asString(input.record.sessionId) ?? input.fallbackKey;
  const model = asString(message?.model) ?? null;
  const dedupeKey =
    `${sessionId}:assistant:` +
    (asString(input.record.requestId) ??
      asString(message?.id) ??
      asString(input.record.uuid) ??
      input.fallbackKey);

  return {
    dedupeKey,
    sample: {
      sessionId,
      timestampMs,
      totalTokens,
      model,
    },
  };
}

function readClaudeToolResultSample(input: {
  record: Record<string, unknown>;
  fallbackKey: string;
}): { dedupeKey: string; sample: ClaudeUsageSample } | null {
  const toolUseResult = asRecord(input.record.toolUseResult);
  const usage = asRecord(toolUseResult?.usage);
  const totalTokens = readClaudeTotalTokens(usage);
  const timestampMs = parseTimestampMs(input.record.timestamp);
  if (!toolUseResult || !usage || totalTokens <= 0 || timestampMs === null) {
    return null;
  }

  const sessionId = asString(input.record.sessionId) ?? input.fallbackKey;
  const dedupeKey =
    `${sessionId}:tool-result:` +
    (asString(input.record.uuid) ??
      asString(toolUseResult.agentId) ??
      asString(input.record.requestId) ??
      input.fallbackKey);

  return {
    dedupeKey,
    sample: {
      sessionId,
      timestampMs,
      totalTokens,
      model: null,
    },
  };
}

// Claude Code stores transcripts under `<CLAUDE_CONFIG_DIR>/projects`, defaulting to
// `~/.claude/projects`. Honor the override so the Profile reads the SAME transcripts
// the active Claude provider does (the adapter inherits `process.env`).
function resolveClaudeProjectsRoot(homeDir: string): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  return nodePath.join(configDir || nodePath.join(homeDir, ".claude"), "projects");
}

async function listRecentClaudeTranscriptFiles(
  projectsRoot: string,
  maxFiles: number = MAX_RECENT_USAGE_FILES,
): Promise<ReadonlyArray<string>> {
  const candidates: string[] = [];
  const projectEntries = await safeReadDir(projectsRoot);

  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) {
      continue;
    }

    const projectDir = nodePath.join(projectsRoot, projectEntry.name);
    const transcriptEntries = await safeReadDir(projectDir);
    for (const transcriptEntry of transcriptEntries) {
      if (transcriptEntry.isFile() && transcriptEntry.name.endsWith(".jsonl")) {
        candidates.push(nodePath.join(projectDir, transcriptEntry.name));
      }
    }
  }

  return listRecentFiles(candidates, maxFiles);
}

async function readClaudeUsageSamples(path: string): Promise<ReadonlyArray<ClaudeUsageSample>> {
  let fileContents: string;
  try {
    fileContents = await fs.readFile(path, "utf8");
  } catch {
    return [];
  }

  const samples: ClaudeUsageSample[] = [];
  const seenKeys = new Set<string>();
  const lines = fileContents.split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || !line.trim()) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const record = asRecord(parsed);
    if (!record) {
      continue;
    }

    const fallbackKey = `${path}:${index}`;
    const assistantSample = readClaudeAssistantSample({ record, fallbackKey });
    if (assistantSample && !seenKeys.has(assistantSample.dedupeKey)) {
      seenKeys.add(assistantSample.dedupeKey);
      samples.push(assistantSample.sample);
    }

    const toolResultSample = readClaudeToolResultSample({ record, fallbackKey });
    if (toolResultSample && !seenKeys.has(toolResultSample.dedupeKey)) {
      seenKeys.add(toolResultSample.dedupeKey);
      samples.push(toolResultSample.sample);
    }
  }

  return samples;
}

async function loadCodexUsageSnapshot(input: {
  homeDir: string;
  homePath?: string;
}): Promise<UsageSnapshot | null> {
  const codexHomeDir =
    input.homePath?.trim() || process.env.CODEX_HOME || nodePath.join(input.homeDir, ".codex");
  const sessionsRoot = nodePath.join(codexHomeDir, "sessions");
  const sessionFiles = await listRecentCodexSessionFiles(sessionsRoot);
  if (sessionFiles.length === 0) {
    return null;
  }

  const sessionSummaries = (
    await mapWithConcurrency(
      sessionFiles,
      PROVIDER_USAGE_FILE_READ_CONCURRENCY,
      readCodexSessionSummary,
    )
  ).filter((summary): summary is CodexSessionSummary => summary !== null);

  if (sessionSummaries.length === 0) {
    return null;
  }

  const latestSummary = sessionSummaries.reduce((latest, current) =>
    current.timestampMs > latest.timestampMs ? current : latest,
  );
  const nowMs = Date.now();
  const cutoff24h = nowMs - ONE_DAY_MS;
  const cutoff7d = nowMs - LOOKBACK_7D_MS;
  const cutoff30d = nowMs - LOOKBACK_30D_MS;

  const recent24h = sessionSummaries.filter((summary) => summary.timestampMs >= cutoff24h);
  const recent7d = sessionSummaries.filter((summary) => summary.timestampMs >= cutoff7d);
  const recent30d = sessionSummaries.filter((summary) => summary.timestampMs >= cutoff30d);

  return {
    provider: "codex",
    updatedAt: toIsoString(latestSummary.timestampMs),
    limits: latestSummary.limits,
    usageLines: buildUsageLines({
      tokens24h: recent24h.reduce((total, summary) => total + summary.totalTokens, 0),
      tokens7d: recent7d.reduce((total, summary) => total + summary.totalTokens, 0),
      tokens30d: recent30d.reduce((total, summary) => total + summary.totalTokens, 0),
      sessions24h: recent24h.length,
      sessions7d: recent7d.length,
      sessions30d: recent30d.length,
    }),
    source: "codex-session-archive",
  };
}

async function loadClaudeUsageSnapshot(input: { homeDir: string }): Promise<UsageSnapshot | null> {
  const projectsRoot = resolveClaudeProjectsRoot(input.homeDir);
  const transcriptFiles = await listRecentClaudeTranscriptFiles(projectsRoot);
  if (transcriptFiles.length === 0) {
    return null;
  }

  const usageSamples = (
    await mapWithConcurrency(
      transcriptFiles,
      PROVIDER_USAGE_FILE_READ_CONCURRENCY,
      readClaudeUsageSamples,
    )
  ).flat();

  if (usageSamples.length === 0) {
    return null;
  }

  const nowMs = Date.now();
  const cutoff24h = nowMs - ONE_DAY_MS;
  const cutoff7d = nowMs - LOOKBACK_7D_MS;
  const cutoff30d = nowMs - LOOKBACK_30D_MS;
  const recent24h = usageSamples.filter((sample) => sample.timestampMs >= cutoff24h);
  const recent7d = usageSamples.filter((sample) => sample.timestampMs >= cutoff7d);
  const recent30d = usageSamples.filter((sample) => sample.timestampMs >= cutoff30d);
  const latestSample = usageSamples.reduce((latest, current) =>
    current.timestampMs > latest.timestampMs ? current : latest,
  );

  return {
    provider: "claudeAgent",
    updatedAt: toIsoString(latestSample.timestampMs),
    limits: [],
    usageLines: buildUsageLines({
      tokens24h: recent24h.reduce((total, sample) => total + sample.totalTokens, 0),
      tokens7d: recent7d.reduce((total, sample) => total + sample.totalTokens, 0),
      tokens30d: recent30d.reduce((total, sample) => total + sample.totalTokens, 0),
      sessions24h: new Set(recent24h.map((sample) => sample.sessionId)).size,
      sessions7d: new Set(recent7d.map((sample) => sample.sessionId)).size,
      sessions30d: new Set(recent30d.map((sample) => sample.sessionId)).size,
    }),
    source: "claude-project-transcripts",
  };
}

async function loadProviderUsageSnapshot(input: {
  provider: ProviderKind;
  homeDir: string;
  homePath?: string;
}): Promise<ServerGetProviderUsageSnapshotResult> {
  switch (input.provider) {
    case "codex":
      return loadCodexUsageSnapshot({
        homeDir: input.homeDir,
        ...(input.homePath ? { homePath: input.homePath } : {}),
      });
    case "claudeAgent":
      return loadClaudeUsageSnapshot({ homeDir: input.homeDir });
    default:
      return null;
  }
}

async function getCachedProviderUsageSnapshot(input: {
  provider: ProviderKind;
  homeDir: string;
  homePath?: string;
}): Promise<ServerGetProviderUsageSnapshotResult> {
  const cacheKey = `${input.provider}:${input.homeDir}:${input.homePath?.trim() ?? ""}:${process.env.CLAUDE_CONFIG_DIR?.trim() ?? ""}`;
  const nowMs = Date.now();
  const existing = usageSnapshotCache.get(cacheKey);

  if (existing && existing.expiresAtMs > nowMs) {
    return existing.value;
  }
  if (existing?.pending) {
    return existing.pending;
  }

  const pending = loadProviderUsageSnapshot(input)
    .catch(() => null)
    .then((value) => {
      usageSnapshotCache.set(cacheKey, {
        expiresAtMs: Date.now() + USAGE_CACHE_TTL_MS,
        value,
        pending: null,
      });
      return value;
    });

  usageSnapshotCache.set(cacheKey, {
    expiresAtMs: existing?.expiresAtMs ?? 0,
    value: existing?.value ?? null,
    pending,
  });

  return pending;
}

export const getProviderUsageSnapshot = Effect.fn(function* (
  input: ServerGetProviderUsageSnapshotInput,
) {
  const serverConfig = yield* ServerConfig;
  return yield* Effect.tryPromise({
    try: () =>
      getCachedProviderUsageSnapshot({
        provider: input.provider,
        homeDir: serverConfig.homeDir,
        ...(input.homePath ? { homePath: input.homePath } : {}),
      }),
    catch: () => null,
  });
});

// Reused by the live-usage batch (providerUsage/index.ts) to enrich live snapshots with the
// locally-derived 24h/7d/30d token-total lines for providers that keep on-disk archives.
export async function loadLocalProviderUsageLines(input: {
  provider: ProviderKind;
  homeDir: string;
  homePath?: string;
}): Promise<ReadonlyArray<ServerProviderUsageLine>> {
  try {
    const snapshot = await getCachedProviderUsageSnapshot(input);
    return snapshot?.usageLines ?? [];
  } catch {
    return [];
  }
}
