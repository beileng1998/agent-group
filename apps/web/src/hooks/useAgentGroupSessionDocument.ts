// Loads the latest canonical context.md projection for one Agent Group Session.
// Backed by a sessionId-keyed module cache so every mounted consumer (chat panel,
// terminal panel, Context pane) shares one document and one in-flight request.

import type { AgentGroupSessionDocument, ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useReducer, useRef } from "react";

import { readNativeApi } from "../nativeApi";

interface SessionDocumentEntry {
  document: AgentGroupSessionDocument | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  inflight: Promise<void> | null;
  requestId: number;
  observedThreadVersion: string | undefined;
  refCount: number;
  readonly listeners: Set<() => void>;
}

const entries = new Map<ThreadId, SessionDocumentEntry>();

function getEntry(sessionId: ThreadId): SessionDocumentEntry {
  let entry = entries.get(sessionId);
  if (!entry) {
    entry = {
      document: null,
      error: null,
      loading: false,
      refreshing: false,
      inflight: null,
      requestId: 0,
      observedThreadVersion: undefined,
      refCount: 0,
      listeners: new Set(),
    };
    entries.set(sessionId, entry);
  }
  return entry;
}

function notify(entry: SessionDocumentEntry): void {
  for (const listener of entry.listeners) listener();
}

function releaseEntry(sessionId: ThreadId, entry: SessionDocumentEntry): void {
  if (entry.refCount === 0 && !entry.inflight) {
    entries.delete(sessionId);
  }
}

function loadDocument(sessionId: ThreadId, background: boolean): Promise<void> {
  const entry = getEntry(sessionId);
  if (entry.inflight) return entry.inflight;
  const requestId = ++entry.requestId;
  const api = readNativeApi();
  if (!api) {
    entry.document = null;
    entry.error = "The Agent Group service is unavailable.";
    entry.loading = false;
    notify(entry);
    return Promise.resolve();
  }
  if (background) entry.refreshing = true;
  else entry.loading = true;
  entry.error = null;
  notify(entry);
  entry.inflight = api.agentGroup
    .getSession({ sessionId })
    .then((document) => {
      if (entry.requestId !== requestId) return;
      entry.document = document;
      entry.error = null;
    })
    .catch((loadError: unknown) => {
      if (entry.requestId !== requestId) return;
      entry.error = loadError instanceof Error ? loadError.message : "Context could not be loaded.";
    })
    .finally(() => {
      if (entry.requestId === requestId) {
        entry.loading = false;
        entry.refreshing = false;
        entry.inflight = null;
      }
      notify(entry);
      releaseEntry(sessionId, entry);
    });
  return entry.inflight;
}

export function useAgentGroupSessionDocument(input: {
  sessionId: ThreadId;
  threadUpdatedAt?: string | undefined;
}) {
  const sessionId = input.sessionId;
  const [, bump] = useReducer((count: number) => count + 1, 0);
  const latestThreadVersionRef = useRef<string | undefined>(input.threadUpdatedAt);
  latestThreadVersionRef.current = input.threadUpdatedAt;

  useEffect(() => {
    const entry = getEntry(sessionId);
    entry.refCount += 1;
    entry.observedThreadVersion = latestThreadVersionRef.current;
    const listener = () => bump();
    entry.listeners.add(listener);
    if (!entry.document && !entry.inflight) {
      void loadDocument(sessionId, false);
    } else {
      bump();
    }
    return () => {
      entry.listeners.delete(listener);
      entry.refCount -= 1;
      releaseEntry(sessionId, entry);
    };
  }, [sessionId]);

  useEffect(() => {
    const entry = entries.get(sessionId);
    if (!entry || !entry.document || !input.threadUpdatedAt) return;
    if (entry.observedThreadVersion === input.threadUpdatedAt) return;
    entry.observedThreadVersion = input.threadUpdatedAt;
    void loadDocument(sessionId, true);
  }, [sessionId, input.threadUpdatedAt]);

  const reload = useCallback(
    (background = false) => loadDocument(sessionId, background),
    [sessionId],
  );
  const setDocument = useCallback(
    (document: AgentGroupSessionDocument) => {
      const entry = getEntry(sessionId);
      entry.document = document;
      notify(entry);
    },
    [sessionId],
  );

  const entry = entries.get(sessionId);
  return {
    document: entry?.document ?? null,
    error: entry?.error ?? null,
    loading: entry?.loading ?? true,
    refreshing: entry?.refreshing ?? false,
    reload,
    setDocument,
  };
}
