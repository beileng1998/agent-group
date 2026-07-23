// FILE: remoteBootstrapClient.ts
// Purpose: Read essential browser state over cacheable HTTP, independently of WS.
// Layer: Browser remote transport

import {
  RemoteBootstrapSnapshot,
  type AgentGroupSessionDocument,
  type OrchestrationShellSnapshot,
  type RemoteBootstrapSnapshot as RemoteBootstrapSnapshotValue,
} from "@agent-group/contracts";
import { Schema } from "effect";

import {
  persistRemoteBootstrapSnapshot,
  readCachedRemoteBootstrapSnapshot,
  type CachedRemoteBootstrapSnapshot,
} from "./remoteBootstrapCache";

const REQUEST_TIMEOUT_MS = 120_000;
const THREAD_ROUTE_PATTERN = /^\/[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const decodeSnapshot = Schema.decodeUnknownSync(RemoteBootstrapSnapshot);
const latestByKey = new Map<string, CachedRemoteBootstrapSnapshot>();
const inFlightByKey = new Map<string, Promise<RemoteBootstrapSnapshotValue>>();

function keyFor(threadId: string | null): string {
  return threadId?.trim() || "__shell__";
}

export function resolveRemoteBootstrapThreadId(pathname = window.location.pathname): string | null {
  if (!THREAD_ROUTE_PATTERN.test(pathname)) return null;
  return decodeURIComponent(pathname.split("/", 2)[1] ?? "") || null;
}

async function readCached(threadId: string | null): Promise<CachedRemoteBootstrapSnapshot | null> {
  const key = keyFor(threadId);
  const current = latestByKey.get(key);
  if (current) return current;
  const cached = await readCachedRemoteBootstrapSnapshot(threadId).catch(() => null);
  if (cached) latestByKey.set(key, cached);
  return cached;
}

function bootstrapUrl(threadId: string | null): string {
  if (!threadId) return "/api/remote-bootstrap";
  return `/api/remote-bootstrap?threadId=${encodeURIComponent(threadId)}`;
}

function responseError(response: Response, payload: unknown): Error {
  if (payload && typeof payload === "object" && "error" in payload) {
    const message = (payload as { readonly error?: unknown }).error;
    if (typeof message === "string") return new Error(message);
  }
  return new Error(`Remote bootstrap failed with status ${response.status}`);
}

export function readLatestRemoteBootstrapSnapshot(
  threadId: string | null,
): RemoteBootstrapSnapshotValue | null {
  return latestByKey.get(keyFor(threadId))?.snapshot ?? null;
}

export async function readCachedRemoteBootstrap(
  threadId: string | null,
): Promise<RemoteBootstrapSnapshotValue | null> {
  return (await readCached(threadId))?.snapshot ?? null;
}

export function refreshRemoteBootstrap(
  threadId: string | null,
): Promise<RemoteBootstrapSnapshotValue> {
  const key = keyFor(threadId);
  const existing = inFlightByKey.get(key);
  if (existing) return existing;

  const pending = (async () => {
    const cached = await readCached(threadId);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(bootstrapUrl(threadId), {
        credentials: "same-origin",
        headers,
        signal: controller.signal,
      });
      if (response.status === 304 && cached) return cached.snapshot;
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) throw responseError(response, payload);
      const snapshot = decodeSnapshot(payload);
      if (threadId && snapshot.agentGroupSession?.session.sessionId !== threadId) {
        throw new Error("Remote bootstrap returned the wrong session.");
      }
      const record: CachedRemoteBootstrapSnapshot = {
        key,
        etag: response.headers.get("etag"),
        savedAt: Date.now(),
        snapshot,
      };
      latestByKey.set(key, record);
      await persistRemoteBootstrapSnapshot({
        threadId,
        etag: record.etag,
        snapshot,
      }).catch(() => undefined);
      return snapshot;
    } finally {
      window.clearTimeout(timeout);
    }
  })();
  inFlightByKey.set(key, pending);
  void pending
    .finally(() => {
      if (inFlightByKey.get(key) === pending) inFlightByKey.delete(key);
    })
    .catch(() => undefined);
  return pending;
}

async function cachedFirst(threadId: string | null): Promise<RemoteBootstrapSnapshotValue> {
  const cached = await readCached(threadId);
  if (cached) {
    void refreshRemoteBootstrap(threadId).catch(() => undefined);
    return cached.snapshot;
  }
  return refreshRemoteBootstrap(threadId);
}

export async function getRemoteShellSnapshot(): Promise<OrchestrationShellSnapshot> {
  return (await cachedFirst(resolveRemoteBootstrapThreadId())).shell;
}

export async function getRemoteAgentGroupSession(
  sessionId: string,
): Promise<AgentGroupSessionDocument> {
  // Editors need a server-validated revision. Warm launch gates are primed
  // separately from the durable snapshot and avoid this request entirely.
  const refreshed = await refreshRemoteBootstrap(sessionId);
  if (refreshed.agentGroupSession?.session.sessionId === sessionId) {
    return refreshed.agentGroupSession;
  }
  throw new Error("The session context is unavailable in the remote snapshot.");
}
