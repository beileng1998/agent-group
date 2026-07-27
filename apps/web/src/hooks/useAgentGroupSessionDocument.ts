// Loads the latest canonical context.md projection for one Agent Group Session.

import type { AgentGroupSessionDocument, ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { readNativeApi } from "../nativeApi";

export function useAgentGroupSessionDocument(input: {
  sessionId: ThreadId;
  threadUpdatedAt?: string | undefined;
}) {
  const [document, setDocument] = useState<AgentGroupSessionDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const observedThreadVersionRef = useRef<string | undefined>(input.threadUpdatedAt);
  const latestThreadVersionRef = useRef<string | undefined>(input.threadUpdatedAt);
  latestThreadVersionRef.current = input.threadUpdatedAt;

  const load = useCallback(
    async (background = false) => {
      const requestId = ++requestIdRef.current;
      const api = readNativeApi();
      if (!api) {
        setError("The Agent Group service is unavailable.");
        setLoading(false);
        return;
      }
      if (background) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const nextDocument = await api.agentGroup.getSession({ sessionId: input.sessionId });
        if (requestId === requestIdRef.current) setDocument(nextDocument);
      } catch (loadError) {
        if (requestId === requestIdRef.current) {
          setError(loadError instanceof Error ? loadError.message : "Context could not be loaded.");
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [input.sessionId],
  );

  useEffect(() => {
    setDocument(null);
    observedThreadVersionRef.current = latestThreadVersionRef.current;
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [input.sessionId, load]);

  useEffect(() => {
    if (
      !document ||
      !input.threadUpdatedAt ||
      observedThreadVersionRef.current === input.threadUpdatedAt
    ) {
      return;
    }
    observedThreadVersionRef.current = input.threadUpdatedAt;
    void load(true);
  }, [document, input.threadUpdatedAt, load]);

  return {
    document,
    error,
    loading,
    refreshing,
    reload: load,
    setDocument,
  };
}
