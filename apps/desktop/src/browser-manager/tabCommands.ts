// FILE: browser-manager/tabCommands.ts
// Purpose: Own durable tab navigation, selection, creation, and closing commands.
// Layer: Desktop browser runtime

import type {
  BrowserNavigateInput,
  BrowserNewTabInput,
  BrowserTabInput,
  ThreadBrowserState,
} from "@agent-group/contracts";
import { normalizeBrowserUrlInput as normalizeUrlInput } from "@agent-group/shared/browserSession";

import type { BrowserOAuthPopupController } from "./oauthPopups";
import type { BrowserPageLoader } from "./pageLoading";
import type { BrowserRuntimeRegistry } from "./runtimeRegistry";
import {
  canWebContentsGoBack,
  canWebContentsGoForward,
  createBrowserTab,
  defaultTitleForUrl,
  syncThreadLastError,
} from "./state";
import type { BrowserStateStore } from "./state";
import type { BrowserSuspensionPolicy } from "./suspensionPolicy";
import type { BrowserWorkspaceController } from "./workspaceController";

export class BrowserTabCommands {
  constructor(
    private readonly stateStore: BrowserStateStore,
    private readonly runtimes: BrowserRuntimeRegistry,
    private readonly suspension: BrowserSuspensionPolicy,
    private readonly pageLoader: BrowserPageLoader,
    private readonly popups: BrowserOAuthPopupController,
    private readonly workspace: BrowserWorkspaceController,
  ) {}

  navigate(input: BrowserNavigateInput): ThreadBrowserState {
    const state = this.stateStore.ensureWorkspace(input.threadId);
    const tab = this.stateStore.resolveTab(state, input.tabId);
    const nextUrl = normalizeUrlInput(input.url);
    tab.url = nextUrl;
    tab.title = defaultTitleForUrl(nextUrl);
    tab.lastCommittedUrl = null;
    tab.lastError = null;
    syncThreadLastError(state);
    this.stateStore.markThreadStateChanged(input.threadId);

    const runtime = this.runtimes.get(input.threadId, tab.id);
    if (runtime) {
      const bounds = this.runtimes.getVisibleBoundsForThread(input.threadId);
      if (state.activeTabId === tab.id && bounds) this.runtimes.attachRuntime(runtime, bounds);
      void this.pageLoader.load(input.threadId, tab.id, { force: true, runtime });
    } else if (this.runtimes.isActiveThread(input.threadId)) {
      const nextRuntime = this.runtimes.ensureLiveRuntime(input.threadId, tab.id);
      this.suspension.clearThreadSuspendTimer(input.threadId);
      const bounds = this.runtimes.getVisibleBoundsForThread(input.threadId);
      if (state.activeTabId === tab.id && bounds) this.runtimes.attachRuntime(nextRuntime, bounds);
      void this.pageLoader.load(input.threadId, tab.id, { force: true, runtime: nextRuntime });
    }

    this.stateStore.emitState(input.threadId);
    return this.stateStore.snapshotThreadState(input.threadId, state);
  }

  reload(input: BrowserTabInput): ThreadBrowserState {
    const state = this.stateStore.ensureWorkspace(input.threadId);
    const tab = this.stateStore.resolveTab(state, input.tabId);
    const runtime = this.runtimes.get(input.threadId, tab.id);
    if (runtime) {
      runtime.webContents.reload();
    } else if (this.runtimes.isActiveThread(input.threadId)) {
      this.suspension.resumeThread(input.threadId);
      void this.pageLoader.load(input.threadId, tab.id, { force: true });
    }
    return this.stateStore.snapshotThreadState(input.threadId, state);
  }

  goBack(input: BrowserTabInput): ThreadBrowserState {
    const runtime = this.runtimes.get(input.threadId, input.tabId);
    if (runtime && canWebContentsGoBack(runtime.webContents)) runtime.webContents.goBack();
    return this.stateStore.snapshotThreadState(input.threadId);
  }

  goForward(input: BrowserTabInput): ThreadBrowserState {
    const runtime = this.runtimes.get(input.threadId, input.tabId);
    if (runtime && canWebContentsGoForward(runtime.webContents)) runtime.webContents.goForward();
    return this.stateStore.snapshotThreadState(input.threadId);
  }

  newTab(input: BrowserNewTabInput): ThreadBrowserState {
    const state = this.stateStore.ensureWorkspace(input.threadId);
    const tab = createBrowserTab(normalizeUrlInput(input.url));
    state.tabs = [...state.tabs, tab];
    if (input.activate !== false || !state.activeTabId) state.activeTabId = tab.id;

    if (this.runtimes.isActiveThread(input.threadId)) {
      this.suspension.resumeThread(input.threadId);
      const bounds = this.runtimes.getVisibleBoundsForThread(input.threadId);
      if (state.activeTabId === tab.id && bounds) {
        this.workspace.attachActiveTab(input.threadId, bounds, { forceLoad: true });
      }
    } else {
      tab.status = "suspended";
    }

    syncThreadLastError(state);
    this.stateStore.markThreadStateChanged(input.threadId);
    this.stateStore.emitState(input.threadId);
    return this.stateStore.snapshotThreadState(input.threadId, state);
  }

  closeTab(input: BrowserTabInput): ThreadBrowserState {
    const state = this.stateStore.ensureWorkspace(input.threadId);
    const nextTabs = state.tabs.filter((tab) => tab.id !== input.tabId);
    if (nextTabs.length === state.tabs.length) {
      return this.stateStore.snapshotThreadState(input.threadId, state);
    }

    this.popups.closeForTab(input.threadId, input.tabId);
    this.runtimes.destroyRuntime(input.threadId, input.tabId);
    state.tabs = nextTabs;
    if (nextTabs.length === 0) {
      const replacementTab = createBrowserTab();
      state.tabs = [replacementTab];
      state.activeTabId = replacementTab.id;
      state.lastError = null;
      this.stateStore.markThreadStateChanged(input.threadId);
      this.stateStore.emitState(input.threadId);
      return this.stateStore.snapshotThreadState(input.threadId, state);
    }

    if (!state.activeTabId || state.activeTabId === input.tabId) {
      state.activeTabId = nextTabs[Math.max(0, nextTabs.length - 1)]?.id ?? null;
    }
    const bounds = this.runtimes.getVisibleBoundsForThread(input.threadId);
    if (this.runtimes.isActiveThread(input.threadId) && bounds) {
      this.workspace.attachActiveTab(input.threadId, bounds);
    }

    syncThreadLastError(state);
    this.stateStore.markThreadStateChanged(input.threadId);
    this.stateStore.emitState(input.threadId);
    return this.stateStore.snapshotThreadState(input.threadId, state);
  }

  selectTab(input: BrowserTabInput): ThreadBrowserState {
    const state = this.stateStore.ensureWorkspace(input.threadId);
    const tab = this.stateStore.resolveTab(state, input.tabId);
    if (state.activeTabId !== tab.id) {
      state.activeTabId = tab.id;
      syncThreadLastError(state);
      this.stateStore.markThreadStateChanged(input.threadId);
      this.stateStore.emitState(input.threadId);
    }

    if (this.runtimes.isActiveThread(input.threadId)) {
      this.suspension.resumeThread(input.threadId);
      const bounds = this.runtimes.getVisibleBoundsForThread(input.threadId);
      if (bounds) this.workspace.attachActiveTab(input.threadId, bounds);
    }
    return this.stateStore.snapshotThreadState(input.threadId, state);
  }

  openDevTools(input: BrowserTabInput): void {
    const state = this.stateStore.ensureWorkspace(input.threadId);
    const tab = this.stateStore.resolveTab(state, input.tabId);
    if (state.activeTabId !== tab.id) {
      state.activeTabId = tab.id;
      syncThreadLastError(state);
      this.stateStore.markThreadStateChanged(input.threadId);
      this.stateStore.emitState(input.threadId);
    }

    this.suspension.resumeThread(input.threadId);
    const runtime = this.runtimes.ensureLiveRuntime(input.threadId, tab.id);
    const bounds = this.runtimes.getVisibleBoundsForThread(input.threadId);
    if (bounds) this.workspace.attachActiveTab(input.threadId, bounds);
    runtime.webContents.openDevTools({ mode: "detach" });
  }
}
