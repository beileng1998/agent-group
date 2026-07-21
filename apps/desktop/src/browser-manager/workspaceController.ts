// FILE: browser-manager/workspaceController.ts
// Purpose: Coordinate browser panel visibility, thread activation, and renderer webview adoption.
// Layer: Desktop browser runtime

import { webContents as electronWebContents } from "electron";
import type {
  BrowserAttachWebviewInput,
  BrowserDetachWebviewInput,
  BrowserNavigateInput,
  BrowserPanelBounds,
  BrowserSetPanelBoundsInput,
  BrowserThreadInput,
  ThreadBrowserState,
  ThreadId,
} from "@agent-group/contracts";
import {
  isBlankBrowserTabUrl,
  normalizeBrowserUrlInput as normalizeUrlInput,
} from "@agent-group/shared/browserSession";

import { LIVE_TAB_STATUS, SUSPENDED_TAB_STATUS, type LiveTabRuntime } from "./contracts";
import type { BrowserOAuthPopupController } from "./oauthPopups";
import type { BrowserPageLoader } from "./pageLoading";
import type { BrowserRuntimeRegistry } from "./runtimeRegistry";
import type { BrowserRuntimeStateSync } from "./runtimeStateSync";
import type { BrowserStateStore } from "./state";
import {
  browserBoundsSignature,
  buildRuntimeKey,
  normalizeBounds,
  suspendTabState,
  syncThreadLastError,
} from "./state";
import type { BrowserSuspensionPolicy } from "./suspensionPolicy";

interface BrowserWorkspaceCallbacks {
  navigate(input: BrowserNavigateInput): ThreadBrowserState;
}

export class BrowserWorkspaceController {
  constructor(
    private readonly stateStore: BrowserStateStore,
    private readonly runtimes: BrowserRuntimeRegistry,
    private readonly runtimeSync: BrowserRuntimeStateSync,
    private readonly suspension: BrowserSuspensionPolicy,
    private readonly pageLoader: BrowserPageLoader,
    private readonly popups: BrowserOAuthPopupController,
    private readonly callbacks: BrowserWorkspaceCallbacks,
  ) {}

  open(input: { threadId: ThreadId; initialUrl?: string }): ThreadBrowserState {
    const state = this.stateStore.ensureWorkspace(input.threadId, input.initialUrl);
    const didChange = !state.open;
    state.open = true;
    const nextInitialUrl = input.initialUrl ? normalizeUrlInput(input.initialUrl) : null;
    const activeTab = nextInitialUrl ? this.stateStore.getActiveTab(state) : null;
    if (nextInitialUrl && activeTab && activeTab.url !== nextInitialUrl) {
      return this.callbacks.navigate({
        threadId: input.threadId,
        tabId: activeTab.id,
        url: nextInitialUrl,
      });
    }

    const nextDidChange = syncThreadLastError(state) || didChange;
    const bounds = this.runtimes.getActiveBounds();
    if (
      bounds &&
      this.runtimes.getActiveBoundsThreadId() === input.threadId &&
      (this.runtimes.getActiveThreadId() === null || this.runtimes.isActiveThread(input.threadId))
    ) {
      const visibleTab = this.stateStore.getActiveTab(state);
      if (!isBlankBrowserTabUrl(visibleTab)) this.activateThread(input.threadId, bounds);
    }

    if (nextDidChange) this.stateStore.markThreadStateChanged(input.threadId);
    this.stateStore.emitState(input.threadId);
    return this.stateStore.snapshotThreadState(input.threadId, state);
  }

  close(input: BrowserThreadInput): ThreadBrowserState {
    this.suspension.clearThreadSuspendTimer(input.threadId);
    if (this.runtimes.isActiveThread(input.threadId)) {
      this.runtimes.detachAttachedRuntime();
      this.runtimes.setActiveThreadId(null);
    }
    this.runtimes.clearActiveBoundsForThread(input.threadId);
    this.popups.closeForThread(input.threadId);
    this.runtimes.destroyThreadRuntimes(input.threadId);

    const state = this.stateStore.getOrCreateState(input.threadId);
    state.open = false;
    state.activeTabId = null;
    state.tabs = [];
    state.lastError = null;
    this.stateStore.markThreadStateChanged(input.threadId);
    this.stateStore.forgetLastEmittedVersion(input.threadId);
    this.stateStore.emitState(input.threadId);
    return this.stateStore.snapshotThreadState(input.threadId, state);
  }

  hide(input: BrowserThreadInput): void {
    const state = this.stateStore.states.get(input.threadId);
    if (this.runtimes.isActiveThread(input.threadId)) {
      this.runtimes.detachAttachedRuntime();
      this.runtimes.setActiveThreadId(null);
    }
    if (state?.open) this.suspension.scheduleThreadSuspend(input.threadId);
  }

  getState(input: BrowserThreadInput): ThreadBrowserState {
    return this.stateStore.snapshotThreadState(input.threadId);
  }

  setPanelBounds(input: BrowserSetPanelBoundsInput): void {
    this.stateStore.perfCounters.setPanelBoundsCalls += 1;
    const state = this.stateStore.getOrCreateState(input.threadId);
    const nextBounds = normalizeBounds(input.bounds);
    const nextBoundsSignature = browserBoundsSignature(nextBounds);
    const activeTabId = this.stateStore.getActiveTab(state)?.id ?? null;
    const activeRuntimeKey = activeTabId ? buildRuntimeKey(input.threadId, activeTabId) : null;
    const activeRuntime = activeTabId ? this.runtimes.get(input.threadId, activeTabId) : null;
    this.runtimes.setActiveBounds(input.threadId, nextBounds);

    if (!state.open || nextBounds === null) {
      if (this.runtimes.isActiveThread(input.threadId)) {
        this.runtimes.detachAttachedRuntime();
        this.runtimes.setActiveThreadId(null);
        this.suspension.scheduleThreadSuspend(input.threadId);
      }
      return;
    }

    if (
      input.surface === "native" &&
      activeTabId &&
      activeRuntime &&
      !activeRuntime.ownsWebContents
    ) {
      this.runtimes.destroyRuntime(input.threadId, activeTabId);
      const activeTab = this.stateStore.getTab(state, activeTabId);
      if (activeTab) {
        suspendTabState(activeTab);
        this.stateStore.markThreadStateChanged(input.threadId);
      }
      this.runtimes.clearAttachedRuntimeIdentity();
    }

    if (input.surface === "renderer" && activeTabId && !activeRuntime) {
      this.activateThreadForPendingRenderer(input.threadId, nextBounds);
      return;
    }

    if (
      this.runtimes.isActiveThread(input.threadId) &&
      this.runtimes.getAttachedRuntimeKey() === activeRuntimeKey &&
      this.runtimes.getAttachedBoundsSignature() === nextBoundsSignature
    ) {
      this.stateStore.perfCounters.setPanelBoundsNoopSkips += 1;
      return;
    }

    this.popups.updateForThread(input.threadId);
    if (this.runtimes.isActiveThread(input.threadId)) {
      if (activeRuntimeKey && this.runtimes.getAttachedRuntimeKey() === activeRuntimeKey) {
        const runtime = this.runtimes.getByKey(activeRuntimeKey);
        if (runtime) {
          this.stateStore.perfCounters.setPanelBoundsViewportUpdates += 1;
          this.runtimes.attachRuntime(runtime, nextBounds);
          return;
        }
      }
      this.attachActiveTab(input.threadId, nextBounds);
      return;
    }
    this.activateThread(input.threadId, nextBounds);
  }

  attachWebview(input: BrowserAttachWebviewInput): ThreadBrowserState {
    const state = this.stateStore.ensureWorkspace(input.threadId);
    const tab = this.stateStore.resolveTab(state, input.tabId);
    const webContents = electronWebContents.fromId(input.webContentsId);
    if (!webContents || webContents.isDestroyed()) {
      throw new Error("The visible browser webview is not available.");
    }

    const key = buildRuntimeKey(input.threadId, tab.id);
    const existingRendererRuntime = this.runtimes.findRendererRuntimeByWebContentsId(
      webContents.id,
    );
    if (existingRendererRuntime && existingRendererRuntime.key !== key) {
      this.runtimes.destroyRuntime(existingRendererRuntime.threadId, existingRendererRuntime.tabId);
    }
    const existing = this.runtimes.getByKey(key);
    if (existing?.webContents.id !== webContents.id) {
      if (existing) this.runtimes.destroyRuntime(input.threadId, tab.id);
      const runtime: LiveTabRuntime = {
        key,
        threadId: input.threadId,
        tabId: tab.id,
        webContents,
        view: null,
        ownsWebContents: false,
        listenerDisposers: [],
      };
      this.runtimes.registerRendererRuntime(runtime);
    }

    const bounds = this.runtimes.getVisibleBoundsForThread(input.threadId);
    const runtime = this.runtimes.getByKey(key);
    if (runtime && bounds) this.runtimes.attachRuntime(runtime, bounds);

    const didChange = tab.status !== LIVE_TAB_STATUS || tab.lastError !== null;
    tab.status = LIVE_TAB_STATUS;
    tab.lastError = null;
    syncThreadLastError(state);
    if (didChange) this.stateStore.markThreadStateChanged(input.threadId);
    this.runtimeSync.queue(input.threadId, tab.id);
    this.stateStore.emitState(input.threadId);
    return this.stateStore.snapshotThreadState(input.threadId, state);
  }

  detachWebview(input: BrowserDetachWebviewInput): void {
    const state = this.stateStore.states.get(input.threadId);
    const tab = state ? this.stateStore.getTab(state, input.tabId) : null;
    if (!state || !tab) return;
    const runtime = this.runtimes.get(input.threadId, input.tabId);
    if (!runtime || runtime.ownsWebContents || runtime.webContents.id !== input.webContentsId)
      return;

    this.runtimes.destroyRuntime(input.threadId, input.tabId);
    const didChange = suspendTabState(tab) || syncThreadLastError(state);
    if (didChange) {
      this.stateStore.markThreadStateChanged(input.threadId);
      this.stateStore.emitState(input.threadId);
    }
  }

  activateThread(threadId: ThreadId, bounds: BrowserPanelBounds): void {
    const previousThreadId = this.runtimes.getActiveThreadId();
    if (previousThreadId && previousThreadId !== threadId) {
      this.suspension.scheduleThreadSuspend(previousThreadId);
    }
    this.runtimes.setActiveThreadId(threadId);
    this.runtimes.setActiveBounds(threadId, bounds);
    if (previousThreadId && previousThreadId !== threadId) {
      this.popups.updateForThread(previousThreadId);
    }
    this.suspension.resumeThread(threadId);
    this.attachActiveTab(threadId, bounds);
    this.popups.updateForThread(threadId);
  }

  private activateThreadForPendingRenderer(threadId: ThreadId, bounds: BrowserPanelBounds): void {
    const previousThreadId = this.runtimes.getActiveThreadId();
    if (previousThreadId && previousThreadId !== threadId) {
      this.suspension.scheduleThreadSuspend(previousThreadId);
      this.popups.updateForThread(previousThreadId);
    }
    this.runtimes.setActiveThreadId(threadId);
    this.runtimes.setActiveBounds(threadId, bounds);
    this.suspension.clearThreadSuspendTimer(threadId);
    this.popups.updateForThread(threadId);
  }

  attachActiveTab(
    threadId: ThreadId,
    bounds: BrowserPanelBounds,
    options: { forceLoad?: boolean } = {},
  ): void {
    const state = this.stateStore.ensureWorkspace(threadId);
    const activeTab = this.stateStore.getActiveTab(state);
    if (!activeTab) return;

    this.suspension.suspendInactiveTabs(threadId, activeTab.id);
    const wasSuspended = activeTab.status === SUSPENDED_TAB_STATUS;
    const runtime = this.runtimes.ensureLiveRuntime(threadId, activeTab.id);
    this.runtimes.attachRuntime(runtime, bounds);
    if (options.forceLoad || wasSuspended) {
      void this.pageLoader.load(threadId, activeTab.id, {
        force: options.forceLoad || wasSuspended,
        runtime,
      });
    } else {
      this.runtimeSync.sync(threadId, activeTab.id);
    }
  }
}
