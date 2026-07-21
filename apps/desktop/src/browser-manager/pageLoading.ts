// FILE: browser-manager/pageLoading.ts
// Purpose: Load tab URLs while preserving durable loading and error state.
// Layer: Desktop browser runtime

import type { ThreadId } from "@agent-group/contracts";
import { normalizeBrowserUrlInput as normalizeUrlInput } from "@agent-group/shared/browserSession";

import type { LiveTabRuntime } from "./contracts";
import type { BrowserRuntimeRegistry } from "./runtimeRegistry";
import type { BrowserRuntimeStateSync } from "./runtimeStateSync";
import { isAbortedNavigationError, syncThreadLastError } from "./state";
import type { BrowserStateStore } from "./state";

export class BrowserPageLoader {
  constructor(
    private readonly stateStore: BrowserStateStore,
    private readonly runtimes: BrowserRuntimeRegistry,
    private readonly runtimeSync: BrowserRuntimeStateSync,
  ) {}

  async load(
    threadId: ThreadId,
    tabId: string,
    options: { force?: boolean; runtime?: LiveTabRuntime } = {},
  ): Promise<void> {
    const state = this.stateStore.ensureWorkspace(threadId);
    const tab = this.stateStore.getTab(state, tabId);
    if (!tab) return;

    const runtime = options.runtime ?? this.runtimes.ensureLiveRuntime(threadId, tabId);
    const webContents = runtime.webContents;
    const nextUrl = normalizeUrlInput(
      options.force === true ? tab.url : (tab.lastCommittedUrl ?? tab.url),
    );
    const currentUrl = webContents.getURL();
    const shouldLoad = options.force === true || currentUrl !== nextUrl || currentUrl.length === 0;
    if (!shouldLoad) {
      this.runtimeSync.queue(threadId, tabId);
      return;
    }

    tab.url = nextUrl;
    tab.status = "live";
    tab.isLoading = true;
    tab.lastError = null;
    syncThreadLastError(state);
    this.stateStore.markThreadStateChanged(threadId);
    this.stateStore.emitState(threadId);

    try {
      await webContents.loadURL(nextUrl);
      this.runtimeSync.queue(threadId, tabId);
    } catch (error) {
      if (isAbortedNavigationError(error)) {
        this.runtimeSync.queue(threadId, tabId);
        return;
      }
      tab.isLoading = false;
      tab.lastError = "Couldn't open this page.";
      syncThreadLastError(state);
      this.stateStore.markThreadStateChanged(threadId);
      this.stateStore.emitState(threadId);
    }
  }
}
