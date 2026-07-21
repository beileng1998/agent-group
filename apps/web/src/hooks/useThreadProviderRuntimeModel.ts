// FILE: useThreadProviderRuntimeModel.ts
// Purpose: Derive the active provider Turn state and synchronize its visited marker.
// Layer: Web chat read model

import { useEffect, useMemo } from "react";

import { deriveCumulativeCostUsd, deriveLatestContextWindowSnapshot } from "../lib/contextWindow";
import { hasLiveTurnTailWork, isLatestTurnSettled } from "../session-logic";
import { useStore } from "../store";
import type { Thread } from "../types";
import { deriveLatestRateLimitStatus } from "../components/chat/RateLimitBanner";
import { getRateLimitBannerDismissalKey } from "../components/chat/chatViewProviderValues";
import { EMPTY_ACTIVITIES, EMPTY_MESSAGES } from "../components/chat/chatViewComposerValues";

export function useThreadProviderRuntimeModel(input: {
  thread: Thread | undefined;
  dismissedRateLimitBannerKey: string | null;
}) {
  const markThreadVisited = useStore((store) => store.markThreadVisited);
  const latestTurn = input.thread?.latestTurn ?? null;
  const activities = input.thread?.activities ?? EMPTY_ACTIVITIES;
  const hasLiveTail = hasLiveTurnTailWork({
    latestTurn,
    messages: input.thread?.messages ?? EMPTY_MESSAGES,
    activities,
    session: input.thread?.session ?? null,
  });
  const contextWindow = useMemo(() => deriveLatestContextWindowSnapshot(activities), [activities]);
  const cumulativeCostUsd = useMemo(() => deriveCumulativeCostUsd(activities), [activities]);
  const rateLimitStatus = useMemo(() => deriveLatestRateLimitStatus(activities), [activities]);
  const rateLimitBannerDismissalKey = useMemo(
    () => getRateLimitBannerDismissalKey(rateLimitStatus, input.thread?.id ?? null),
    [input.thread?.id, rateLimitStatus],
  );
  const visibleRateLimitStatus =
    rateLimitBannerDismissalKey === input.dismissedRateLimitBannerKey ? null : rateLimitStatus;
  const settled = isLatestTurnSettled(latestTurn, input.thread?.session ?? null) && !hasLiveTail;
  // A fresh chat has no started Turn; it must not show live-turn chrome merely
  // because the repository already contains local edits.
  const live = Boolean(latestTurn?.startedAt) && !settled;

  useEffect(() => {
    if (!input.thread?.id || !settled || !latestTurn?.completedAt) return;
    const turnCompletedAt = Date.parse(latestTurn.completedAt);
    if (Number.isNaN(turnCompletedAt)) return;
    const lastVisitedAt = input.thread.lastVisitedAt
      ? Date.parse(input.thread.lastVisitedAt)
      : Number.NaN;
    if (!Number.isNaN(lastVisitedAt) && lastVisitedAt >= turnCompletedAt) return;

    markThreadVisited(input.thread.id, latestTurn.completedAt);
  }, [
    input.thread?.id,
    input.thread?.lastVisitedAt,
    latestTurn?.completedAt,
    markThreadVisited,
    settled,
  ]);

  return {
    latestTurn,
    activities,
    hasLiveTail,
    contextWindow,
    cumulativeCostUsd,
    rateLimitStatus,
    rateLimitBannerDismissalKey,
    visibleRateLimitStatus,
    settled,
    live,
  };
}
