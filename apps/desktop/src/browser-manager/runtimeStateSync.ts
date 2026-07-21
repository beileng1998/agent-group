// FILE: browser-manager/runtimeStateSync.ts
// Purpose: Coalesce WebContents state changes onto durable tab state.
// Layer: Desktop browser runtime

import type { ThreadId } from "@agent-group/contracts";

import type { PendingRuntimeSync } from "./contracts";
import type { BrowserRuntimeRegistry } from "./runtimeRegistry";
import { buildRuntimeKey, syncTabStateFromRuntime, syncThreadLastError } from "./state";
import type { BrowserStateStore } from "./state";

export class BrowserRuntimeStateSync {
  private readonly pendingRuntimeSyncs = new Map<string, PendingRuntimeSync>();
  private runtimeSyncFlushScheduled = false;

  constructor(
    private readonly stateStore: BrowserStateStore,
    private readonly runtimes: BrowserRuntimeRegistry,
  ) {}

  sync(threadId: ThreadId, tabId: string, faviconUrls?: string[]): void {
    this.stateStore.perfCounters.syncRuntimeStateCalls += 1;
    const state = this.stateStore.states.get(threadId);
    const tab = state ? this.stateStore.getTab(state, tabId) : null;
    const runtime = this.runtimes.get(threadId, tabId);
    if (!state || !tab || !runtime) return;

    const didChange = syncTabStateFromRuntime(state, tab, runtime.webContents, faviconUrls);
    const nextDidChange = syncThreadLastError(state) || didChange;
    if (nextDidChange) {
      this.stateStore.markThreadStateChanged(threadId);
      this.stateStore.emitState(threadId);
    }
  }

  queue(threadId: ThreadId, tabId: string, faviconUrls?: string[]): void {
    const key = buildRuntimeKey(threadId, tabId);
    const existing = this.pendingRuntimeSyncs.get(key);
    const nextPendingSync: PendingRuntimeSync = { threadId, tabId };
    const nextFaviconUrls = faviconUrls ?? existing?.faviconUrls;
    if (nextFaviconUrls !== undefined) nextPendingSync.faviconUrls = nextFaviconUrls;
    this.pendingRuntimeSyncs.set(key, nextPendingSync);

    if (this.runtimeSyncFlushScheduled) return;
    this.runtimeSyncFlushScheduled = true;
    queueMicrotask(() => {
      this.runtimeSyncFlushScheduled = false;
      if (this.pendingRuntimeSyncs.size === 0) return;
      this.stateStore.perfCounters.runtimeSyncQueueFlushes += 1;
      const pendingSyncs = [...this.pendingRuntimeSyncs.values()];
      this.pendingRuntimeSyncs.clear();
      for (const pendingSync of pendingSyncs) {
        this.sync(pendingSync.threadId, pendingSync.tabId, pendingSync.faviconUrls);
      }
    });
  }

  clear(key: string): void {
    this.pendingRuntimeSyncs.delete(key);
  }

  dispose(): void {
    this.pendingRuntimeSyncs.clear();
    this.runtimeSyncFlushScheduled = false;
  }
}
