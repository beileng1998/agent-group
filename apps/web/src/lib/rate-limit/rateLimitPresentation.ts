// FILE: rateLimitPresentation.ts
// Purpose: Formats rate-limit values and resolves provider usage help links.
// Layer: Web rate-limit presentation model

import { providerUsageLearnMoreHref } from "@agent-group/shared/providerUsage";
import type { ProviderRateLimit } from "./rateLimitContracts";

export function formatRateLimitRemainingPercent(remainingPercent: number | undefined): string {
  if (remainingPercent === undefined) return "—";
  return `${Math.round(Math.min(100, Math.max(0, remainingPercent)))}%`;
}

/** Relative reset countdown, e.g. "Resets in 2h 16m" / "Resets in 5d 11h". */
export function formatRateLimitResetCountdown(resetsAt: string): string {
  const resetMs = Date.parse(resetsAt);
  if (Number.isNaN(resetMs)) return "";
  const diffMs = resetMs - Date.now();
  if (diffMs <= 0) return "Resets soon";
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `Resets in ${days}d ${hours}h`;
  if (hours > 0) return `Resets in ${hours}h ${minutes}m`;
  if (minutes > 0) return `Resets in ${minutes}m`;
  return "Resets soon";
}

export function formatRateLimitResetTime(resetsAt: string): string {
  const resetMs = Date.parse(resetsAt);
  if (Number.isNaN(resetMs)) return "";
  const diffMs = resetMs - Date.now();
  if (diffMs > 0 && diffMs < 24 * 60 * 60 * 1000) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(resetMs);
  }
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(resetMs);
}

export function deriveRateLimitLearnMoreHref(
  rateLimits: ReadonlyArray<ProviderRateLimit>,
): string | null {
  const providers = new Set(rateLimits.map((rateLimit) => rateLimit.provider));
  if (providers.size !== 1) return null;
  const [provider] = providers;
  return deriveProviderUsageLearnMoreHref(provider);
}

export function deriveProviderUsageLearnMoreHref(
  provider: string | null | undefined,
): string | null {
  return providerUsageLearnMoreHref(provider);
}
