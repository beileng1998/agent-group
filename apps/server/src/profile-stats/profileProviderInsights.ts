import type { ProfileStats, ProviderKind } from "@agent-group/contracts";

import type { TurnInsightRow } from "./profileStatsRows";
import {
  compareNullableText,
  nonEmptyString,
  normalizeProviderKind,
  num,
  percent1,
} from "./profileStatsValues";

export interface ProviderInsights {
  readonly providerModels: ProfileStats["providerModels"];
  readonly topProvider: ProviderKind | null;
  readonly topProviderPercent: number | null;
  readonly topReasoning: string | null;
  readonly topReasoningPercent: number | null;
}

export function aggregateProviderInsights(rows: ReadonlyArray<TurnInsightRow>): ProviderInsights {
  const providerModelCounts = new Map<
    string,
    { readonly provider: string | null; readonly model: string | null; count: number }
  >();
  const reasoningCounts = new Map<string, { readonly reasoning: string; count: number }>();

  for (const row of rows) {
    const count = num(row.count);
    const provider = nonEmptyString(row.provider);
    const model = nonEmptyString(row.model);
    const providerModelKey = `${provider ?? ""}\u0000${model ?? ""}`;
    const existingProviderModel = providerModelCounts.get(providerModelKey);
    if (existingProviderModel) existingProviderModel.count += count;
    else providerModelCounts.set(providerModelKey, { provider, model, count });

    const reasoning = nonEmptyString(row.reasoning);
    if (reasoning) {
      const existingReasoning = reasoningCounts.get(reasoning);
      if (existingReasoning) existingReasoning.count += count;
      else reasoningCounts.set(reasoning, { reasoning, count });
    }
  }

  const providerModelRows = [...providerModelCounts.values()].toSorted(
    (left, right) =>
      right.count - left.count ||
      compareNullableText(left.provider, right.provider) ||
      compareNullableText(left.model, right.model),
  );
  const totalModelTurns = providerModelRows.reduce((sum, row) => sum + num(row.count), 0);
  const providerModels = providerModelRows.slice(0, 8).map((row) => {
    const count = num(row.count);
    return {
      provider: normalizeProviderKind(row.provider),
      model: nonEmptyString(row.model) ?? "unknown",
      turnCount: count,
      percent: percent1(count, totalModelTurns),
    };
  });

  const providerTurnCounts = new Map<ProviderKind, number>();
  for (const row of providerModelRows) {
    const provider = normalizeProviderKind(row.provider);
    if (provider === "unknown") continue;
    providerTurnCounts.set(provider, (providerTurnCounts.get(provider) ?? 0) + num(row.count));
  }
  const totalKnownProviderTurns = [...providerTurnCounts.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  let topProvider: ProviderKind | null = null;
  let topProviderTurns = 0;
  for (const [provider, count] of providerTurnCounts) {
    if (count > topProviderTurns) {
      topProvider = provider;
      topProviderTurns = count;
    }
  }
  const topProviderPercent =
    topProvider && totalKnownProviderTurns > 0
      ? percent1(topProviderTurns, totalKnownProviderTurns)
      : null;

  const reasoningRows = [...reasoningCounts.values()].toSorted(
    (left, right) =>
      right.count - left.count || compareNullableText(left.reasoning, right.reasoning),
  );
  const totalReasonedSelections = reasoningRows.reduce((sum, row) => sum + num(row.count), 0);
  const topReasoningRow = reasoningRows[0];
  const topReasoning = topReasoningRow?.reasoning ?? null;
  const topReasoningPercent =
    topReasoningRow && totalReasonedSelections > 0
      ? percent1(num(topReasoningRow.count), totalReasonedSelections)
      : null;

  return {
    providerModels,
    topProvider,
    topProviderPercent,
    topReasoning,
    topReasoningPercent,
  };
}
