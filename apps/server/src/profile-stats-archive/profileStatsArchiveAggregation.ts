import { aggregateProfileSkillUsageRows } from "../profileStats";

export interface TurnEventRow {
  readonly payloadJson: string | null;
}

export interface TokenActivityRow {
  // Cumulative counter (totalProcessedTokens) and context-window counter
  // (usedTokens); which one drives the delta series is decided per thread,
  // mirroring profileStats.queryTokenActivity.
  readonly totalProcessedTokens: number | bigint | null;
  readonly usedTokens: number | bigint | null;
  // Per-turn attribution resolved in SQL (turn-start modelSelection); NULL when
  // the activity has no attributable turn, in which case the thread's own
  // selection applies as the fallback.
  readonly provider: string | null;
  readonly model: string | null;
  readonly createdAt: string | null;
}

export interface SkillMessageRow {
  readonly messageId: string | null;
  readonly text: string | null;
  readonly skillsJson: string | null;
  readonly mentionsJson: string | null;
}

export interface ThreadTurnSnapshotRow {
  readonly provider: string | null;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly turnCount: number;
}

export interface ThreadTokenSnapshotRow {
  readonly createdAt: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly tokens: number;
}

export interface ModelSelectionLike {
  readonly provider: string | null;
  readonly model: string | null;
  readonly reasoning: string | null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseModelSelection(value: unknown): ModelSelectionLike | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as { provider?: unknown; model?: unknown; options?: unknown };
  const options =
    record.options !== null && typeof record.options === "object"
      ? (record.options as { reasoningEffort?: unknown; effort?: unknown })
      : null;
  return {
    provider: readString(record.provider),
    model: readString(record.model),
    reasoning: readString(options?.reasoningEffort) ?? readString(options?.effort),
  };
}

export function parseModelSelectionJson(json: string | null): ModelSelectionLike | null {
  if (json === null || json.trim().length === 0) {
    return null;
  }
  try {
    return parseModelSelection(JSON.parse(json));
  } catch {
    return null;
  }
}

export function hasProfileStatsContribution(input: {
  readonly promptRows: ReadonlyArray<SkillMessageRow>;
  readonly turnRows: ReadonlyArray<ThreadTurnSnapshotRow>;
  readonly tokenRows: ReadonlyArray<ThreadTokenSnapshotRow>;
  readonly skillRows: ReturnType<typeof aggregateProfileSkillUsageRows>;
}): boolean {
  return (
    input.promptRows.length > 0 ||
    input.turnRows.some((row) => row.turnCount > 0) ||
    input.tokenRows.length > 0 ||
    input.skillRows.some((row) => row.runCount > 0)
  );
}

// Mirrors the per-turn extraction in profileStats.queryTurnInsights: the turn
// event's own modelSelection wins, otherwise the thread's selection applies.
export function aggregateThreadTurnSnapshotRows(
  events: ReadonlyArray<TurnEventRow>,
  threadModelSelectionJson: string | null,
): ThreadTurnSnapshotRow[] {
  const threadSelection = parseModelSelectionJson(threadModelSelectionJson);
  const counts = new Map<
    string,
    { provider: string | null; model: string | null; reasoning: string | null; turnCount: number }
  >();

  for (const event of events) {
    let eventSelection: ModelSelectionLike | null = null;
    if (event.payloadJson !== null) {
      try {
        const payload: unknown = JSON.parse(event.payloadJson);
        if (payload !== null && typeof payload === "object") {
          eventSelection = parseModelSelection(
            (payload as { modelSelection?: unknown }).modelSelection,
          );
        }
      } catch {
        // Malformed payload rows still count as a turn with the thread fallback.
      }
    }
    const selection = eventSelection ?? threadSelection;
    const provider = selection?.provider ?? null;
    const model = selection?.model ?? null;
    const reasoning = selection?.reasoning ?? null;
    const key = `${provider ?? ""}\u0000${model ?? ""}\u0000${reasoning ?? ""}`;
    const existing = counts.get(key);
    if (existing) {
      existing.turnCount += 1;
    } else {
      counts.set(key, { provider, model, reasoning, turnCount: 1 });
    }
  }

  return [...counts.values()];
}

function tokenCounterValue(value: number | bigint | null): number | null {
  const total = typeof value === "bigint" ? Number(value) : value;
  return total !== null && Number.isFinite(total) ? total : null;
}

function tokenProviderModelKey(provider: string | null, model: string | null): string {
  return `${provider ?? ""}\u0000${model ?? ""}`;
}

function addTokenSnapshotRow(
  rows: Map<string, ThreadTokenSnapshotRow>,
  row: ThreadTokenSnapshotRow,
): void {
  const key = `${row.createdAt}\u0000${tokenProviderModelKey(row.provider, row.model)}`;
  const existing = rows.get(key);
  if (existing) {
    rows.set(key, { ...existing, tokens: existing.tokens + row.tokens });
  } else {
    rows.set(key, row);
  }
}

// Mirrors the LAG-based delta in profileStats.queryTokenActivity: rows must be
// ordered the same way that query orders them, and the first total counts fully.
// Cumulative rows stay thread-wide; usedTokens rows are counted only for
// provider/model groups that never emit cumulative totals.
// Deltas keep the original activity timestamp (raw, unparsed) so read-time
// DATETIME(created_at, tz) bucketing stays identical to the live query for any
// client UTC offset, and are keyed by the row's per-turn provider/model (the
// thread's own selection fills in rows without turn attribution).
export function aggregateThreadTokenRows(
  rows: ReadonlyArray<TokenActivityRow>,
  fallbackSelection?: { readonly provider: string | null; readonly model: string | null },
): ThreadTokenSnapshotRow[] {
  const tokensByKey = new Map<string, ThreadTokenSnapshotRow>();
  const cumulativeProviderModels = new Set<string>();
  for (const row of rows) {
    if (tokenCounterValue(row.totalProcessedTokens) === null) {
      continue;
    }
    const provider = readString(row.provider) ?? fallbackSelection?.provider ?? null;
    const model = readString(row.model) ?? fallbackSelection?.model ?? null;
    cumulativeProviderModels.add(tokenProviderModelKey(provider, model));
  }

  let previousCumulativeTotal: number | null = null;
  for (const row of rows) {
    const total = tokenCounterValue(row.totalProcessedTokens);
    if (total === null) {
      continue;
    }
    const delta =
      previousCumulativeTotal === null || total < previousCumulativeTotal
        ? total
        : Math.max(0, total - previousCumulativeTotal);
    previousCumulativeTotal = total;
    if (delta <= 0 || row.createdAt === null) {
      continue;
    }
    const provider = readString(row.provider) ?? fallbackSelection?.provider ?? null;
    const model = readString(row.model) ?? fallbackSelection?.model ?? null;
    addTokenSnapshotRow(tokensByKey, {
      createdAt: row.createdAt,
      provider,
      model,
      tokens: delta,
    });
  }

  let previousUsedTotal: number | null = null;
  let previousUsedProviderModelKey: string | null = null;
  for (const row of rows) {
    const provider = readString(row.provider) ?? fallbackSelection?.provider ?? null;
    const model = readString(row.model) ?? fallbackSelection?.model ?? null;
    const providerModelKey = tokenProviderModelKey(provider, model);
    if (cumulativeProviderModels.has(providerModelKey)) {
      continue;
    }
    const total = tokenCounterValue(row.usedTokens);
    if (total === null) {
      continue;
    }
    const delta =
      previousUsedTotal === null ||
      (total < previousUsedTotal && providerModelKey !== previousUsedProviderModelKey)
        ? total
        : Math.max(0, total - previousUsedTotal);
    previousUsedTotal = total;
    previousUsedProviderModelKey = providerModelKey;
    if (delta <= 0 || row.createdAt === null) {
      continue;
    }
    addTokenSnapshotRow(tokensByKey, {
      createdAt: row.createdAt,
      provider,
      model,
      tokens: delta,
    });
  }
  return [...tokensByKey.values()];
}
