// FILE: useNonCodexSteerGate.ts
// Purpose: Hold queued auto-dispatch across a non-Codex interrupt/restart gap.
// Layer: Web composer lifecycle controller

import { type ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useState } from "react";

import { resolveQueuedSteerGateTransition } from "../components/ChatView.dispatch";
import type { SessionPhase } from "../types";

export function useNonCodexSteerGate(input: {
  threadId: ThreadId;
  phase: SessionPhase;
  sessionErrored: boolean;
}) {
  const [gate, setGate] = useState<{
    sawInterruptGap: boolean;
    gapStartedAt: number | null;
  } | null>(null);

  const begin = useCallback(() => {
    setGate({ sawInterruptGap: false, gapStartedAt: null });
  }, []);

  useEffect(() => setGate(null), [input.threadId]);
  useEffect(() => {
    if (!gate) return;
    const transition = resolveQueuedSteerGateTransition({
      gate,
      phase: input.phase,
      sessionErrored: input.sessionErrored,
      now: Date.now(),
    });
    if (transition.kind === "clear") {
      setGate(null);
      return;
    }
    if (
      transition.gate.sawInterruptGap !== gate.sawInterruptGap ||
      transition.gate.gapStartedAt !== gate.gapStartedAt
    ) {
      setGate(transition.gate);
      return;
    }
    if (transition.expiresInMs === null) return;
    const timer = window.setTimeout(() => setGate(null), transition.expiresInMs);
    return () => window.clearTimeout(timer);
  }, [gate, input.phase, input.sessionErrored]);

  return { active: gate !== null, begin };
}
