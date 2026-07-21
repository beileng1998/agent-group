// FILE: useActiveTurnPresentationController.ts
// Purpose: Own active-turn timing and the settled layout grace window.
// Layer: Web thread presentation controller

import { type ThreadId } from "@agent-group/contracts";
import { useLayoutEffect, useRef, useState } from "react";

import {
  ACTIVE_TURN_LAYOUT_SETTLE_DELAY_MS,
  shouldStartActiveTurnLayoutGrace,
} from "../components/ChatView.logic";
import { deriveActiveWorkStartedAt } from "../session-logic";
import type { Thread } from "../types";

export function useActiveTurnPresentationController(input: {
  activeThreadId: ThreadId | null;
  latestTurn: Thread["latestTurn"] | null;
  session: Thread["session"] | null;
  hasLiveTurnTail: boolean;
  hasLiveTurn: boolean;
  hasLiveTranscriptOutput: boolean;
  latestTurnLive: boolean;
}) {
  const activeTurnLayoutLive = input.hasLiveTranscriptOutput || input.latestTurnLive;
  const [keepSettledLayout, setKeepSettledLayout] = useState(false);
  const previousLayoutLiveRef = useRef(activeTurnLayoutLive);
  const previousLayoutKeyRef = useRef<string | null>(null);
  const activeTurnLayoutKey =
    input.activeThreadId === null
      ? null
      : `${input.activeThreadId}:${input.latestTurn?.turnId ?? "idle"}`;
  const activeWorkStartedAt = input.hasLiveTurnTail
    ? (input.latestTurn?.startedAt ?? null)
    : input.hasLiveTurn
      ? deriveActiveWorkStartedAt(input.latestTurn, input.session, null)
      : null;

  useLayoutEffect(() => {
    if (previousLayoutKeyRef.current !== activeTurnLayoutKey) {
      previousLayoutKeyRef.current = activeTurnLayoutKey;
      previousLayoutLiveRef.current = activeTurnLayoutLive;
      setKeepSettledLayout(false);
      return;
    }
    const shouldStartGrace = shouldStartActiveTurnLayoutGrace({
      previousTurnLayoutLive: previousLayoutLiveRef.current,
      currentTurnLayoutLive: activeTurnLayoutLive,
      latestTurnStartedAt: input.latestTurn?.startedAt ?? null,
    });
    previousLayoutLiveRef.current = activeTurnLayoutLive;
    if (activeTurnLayoutLive) {
      setKeepSettledLayout(false);
      return;
    }
    if (!shouldStartGrace) return;
    setKeepSettledLayout(true);
    const timeoutId = window.setTimeout(
      () => setKeepSettledLayout(false),
      ACTIVE_TURN_LAYOUT_SETTLE_DELAY_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [activeTurnLayoutKey, activeTurnLayoutLive, input.latestTurn?.startedAt]);

  return {
    activeTurnInProgress: activeTurnLayoutLive || keepSettledLayout,
    activeWorkStartedAt,
  };
}
