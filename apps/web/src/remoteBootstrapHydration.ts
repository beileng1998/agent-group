// FILE: remoteBootstrapHydration.ts
// Purpose: Hydrate cached HTTP snapshots and keep them fresh while WS is degraded.
// Layer: Browser bootstrap orchestration

import type { RemoteBootstrapSnapshot } from "@agent-group/contracts";

import { markAgentGroupSessionPrepared } from "./agentGroupSessionReadinessCache";
import { useStore } from "./store";
import {
  readCachedRemoteBootstrap,
  refreshRemoteBootstrap,
  resolveRemoteBootstrapThreadId,
} from "./remoteBootstrapClient";
import {
  addWsTransportStateListener,
  type WsTransportState,
} from "./wsTransportEvents";

const DEGRADED_REFRESH_INTERVAL_MS = 15_000;
let fallbackStarted = false;

export function hydrateRemoteBootstrapSnapshot(snapshot: RemoteBootstrapSnapshot): void {
  const store = useStore.getState();
  store.syncServerShellSnapshot(snapshot.shell);
  if (snapshot.thread) store.syncServerThreadDetail(snapshot.thread.thread);
  const session = snapshot.agentGroupSession;
  if (session) {
    markAgentGroupSessionPrepared(
      `${session.config.groupId}:${session.session.sessionId}:${session.session.parentSessionId ?? "root"}:${session.session.createdAt}`,
    );
  }
}

export async function hydrateCachedRemoteBootstrapForCurrentRoute(): Promise<boolean> {
  const cached = await readCachedRemoteBootstrap(resolveRemoteBootstrapThreadId()).catch(() => null);
  if (!cached) return false;
  hydrateRemoteBootstrapSnapshot(cached);
  return true;
}

export async function refreshAndHydrateRemoteBootstrap(): Promise<void> {
  const snapshot = await refreshRemoteBootstrap(resolveRemoteBootstrapThreadId());
  hydrateRemoteBootstrapSnapshot(snapshot);
}

export function startRemoteBootstrapFallbackSync(): void {
  if (fallbackStarted || typeof window === "undefined") return;
  fallbackStarted = true;
  let state: WsTransportState = "connecting";
  let timer: number | null = null;
  let paused = false;

  const clearTimer = () => {
    if (timer === null) return;
    window.clearTimeout(timer);
    timer = null;
  };
  const schedule = (delayMs: number) => {
    if (paused || state === "open" || timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      void refreshAndHydrateRemoteBootstrap()
        .catch(() => undefined)
        .finally(() => schedule(DEGRADED_REFRESH_INTERVAL_MS));
    }, delayMs);
  };

  addWsTransportStateListener((nextState) => {
    state = nextState;
    if (state === "open") clearTimer();
    else schedule(0);
  });
  const handleVisibility = () => {
    if (document.visibilityState === "visible" && state !== "open") schedule(0);
  };
  document.addEventListener("visibilitychange", handleVisibility);
  schedule(0);

  window.addEventListener("pagehide", () => {
    paused = true;
    clearTimer();
  });
  window.addEventListener("pageshow", () => {
    paused = false;
    if (state !== "open") schedule(0);
  });
}
