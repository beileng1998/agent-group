import type { ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useState } from "react";

import {
  invalidateAgentGroupSessionReadiness,
  isAgentGroupSessionPrepared,
  prepareAgentGroupSession,
} from "../agentGroupSessionReadinessCache";
import { readNativeApi } from "../nativeApi";

export interface AgentGroupSessionGate {
  ready: boolean;
  error: string | null;
  retry: () => void;
}

export function useAgentGroupSessionGate(input: {
  threadId: ThreadId;
  sessionKey: string | null;
}): AgentGroupSessionGate {
  const [preparedSessionKey, setPreparedSessionKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!input.sessionKey) {
      setPreparedSessionKey(null);
      setError(null);
      return;
    }

    const api = readNativeApi();
    if (!api) {
      setError("The Agent Group service is unavailable.");
      return;
    }

    let cancelled = false;
    setError(null);
    void prepareAgentGroupSession(input.sessionKey, () =>
      api.agentGroup.getSession({ sessionId: input.threadId }),
    )
      .then(() => {
        if (!cancelled) setPreparedSessionKey(input.sessionKey);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "The session context could not be prepared.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, input.sessionKey, input.threadId]);

  const retry = useCallback(() => {
    if (input.sessionKey) invalidateAgentGroupSessionReadiness(input.sessionKey);
    setAttempt((value) => value + 1);
  }, [input.sessionKey]);

  return {
    ready:
      input.sessionKey !== null &&
      (preparedSessionKey === input.sessionKey || isAgentGroupSessionPrepared(input.sessionKey)),
    error,
    retry,
  };
}
