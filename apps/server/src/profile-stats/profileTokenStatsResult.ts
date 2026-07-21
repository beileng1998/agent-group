import type { ProfileTokenStats, ProviderKind } from "@agent-group/contracts";

import { buildHeatmap } from "./profileActivityMetrics";
import type { TokenDayRow, TurnInsightRow } from "./profileStatsRows";
import { aggregateTokenActivity } from "./profileTokenAggregation";
import {
  compareNullableText,
  localToday,
  normalizeProviderKind,
  percent1,
} from "./profileStatsValues";

export function buildProfileTokenStatsResult(
  utcOffsetMinutes: number,
  rows: ReadonlyArray<TokenDayRow>,
  turnInsightRows: ReadonlyArray<TurnInsightRow>,
): ProfileTokenStats {
  const todayKey = localToday(utcOffsetMinutes);
  const { tokensByDay, tokensByProvider, tokensByProviderModel, lifetime } =
    aggregateTokenActivity(rows);

  let peakDay: string | null = null;
  let peakDayTokens: number | null = null;
  for (const [day, tokens] of tokensByDay) {
    if (peakDayTokens === null || tokens > peakDayTokens) {
      peakDayTokens = tokens;
      peakDay = day;
    }
  }

  const providers = [...tokensByProvider.entries()]
    .filter(([, tokens]) => tokens > 0)
    .toSorted((a, b) => b[1] - a[1])
    .map(([provider]) => provider);
  const available = lifetime > 0;

  const providersWithTurns = new Set<ProviderKind>();
  for (const row of turnInsightRows) {
    const provider = normalizeProviderKind(row.provider);
    if (provider !== "unknown") providersWithTurns.add(provider);
  }
  const unavailableProviders = [...providersWithTurns]
    .filter((provider) => !tokensByProvider.has(provider))
    .toSorted();

  const totalProviderTokens = [...tokensByProvider.values()].reduce(
    (sum, tokens) => sum + tokens,
    0,
  );
  const topProvider = providers[0] ?? null;
  const topProviderPercent =
    topProvider && totalProviderTokens > 0
      ? percent1(tokensByProvider.get(topProvider) ?? 0, totalProviderTokens)
      : null;

  const models = [...tokensByProviderModel.values()]
    .filter((row) => row.tokens > 0)
    .toSorted(
      (left, right) =>
        right.tokens - left.tokens ||
        compareNullableText(left.provider, right.provider) ||
        compareNullableText(left.model, right.model),
    )
    .slice(0, 8)
    .map((row) => ({
      provider: row.provider,
      model: row.model,
      tokens: row.tokens,
      percent: percent1(row.tokens, lifetime),
    }));

  return {
    available,
    lifetimeTotalTokens: available ? lifetime : null,
    peakDayTokens,
    peakDay,
    providers,
    unavailableProviders,
    topProvider,
    topProviderPercent,
    models,
    heatmapMetric: "tokens",
    heatmap: buildHeatmap(tokensByDay, todayKey),
  } satisfies ProfileTokenStats;
}
