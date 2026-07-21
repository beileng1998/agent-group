import type { ServerProviderUsageLimit } from "@agent-group/contracts";

import { asNonNegativeNumber, asRecord, asString } from "./usageSnapshotValues";

export function normalizeCodexUsageLimits(value: unknown): ReadonlyArray<ServerProviderUsageLimit> {
  const rateLimits = asRecord(value);
  if (!rateLimits) return [];

  const parseLimit = (
    label: string,
    source: Record<string, unknown> | null,
  ): ServerProviderUsageLimit | null => {
    if (!source) return null;
    const usedPercent = asNonNegativeNumber(source.used_percent ?? source.usedPercent);
    const windowDurationMins = asNonNegativeNumber(source.window_minutes ?? source.windowMinutes);
    const resetsAt =
      asString(source.resets_at ?? source.resetsAt) ??
      asString(source.next_reset_at ?? source.nextResetAt);
    if (usedPercent === undefined && windowDurationMins === undefined && !resetsAt) return null;
    return {
      window: label,
      ...(usedPercent !== undefined ? { usedPercent } : {}),
      ...(windowDurationMins !== undefined ? { windowDurationMins } : {}),
      ...(resetsAt ? { resetsAt } : {}),
    };
  };

  const primary = parseLimit("5h", asRecord(rateLimits.primary));
  const secondary = parseLimit("Weekly", asRecord(rateLimits.secondary));
  return [primary, secondary].filter((limit): limit is ServerProviderUsageLimit => limit !== null);
}

export function readCodexTotalTokens(payload: Record<string, unknown>): number {
  const info = asRecord(payload.info);
  const totalUsage =
    asRecord(info?.total_token_usage) ??
    asRecord(info?.totalTokenUsage) ??
    asRecord(info?.total) ??
    asRecord(payload.total_token_usage) ??
    asRecord(payload.totalTokenUsage) ??
    asRecord(payload.total);
  return (
    asNonNegativeNumber(totalUsage?.total_tokens) ??
    asNonNegativeNumber(totalUsage?.totalTokens) ??
    asNonNegativeNumber(info?.total_tokens) ??
    asNonNegativeNumber(info?.totalTokens) ??
    asNonNegativeNumber(payload.total_tokens) ??
    asNonNegativeNumber(payload.totalTokens) ??
    0
  );
}
