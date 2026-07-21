// FILE: browserManager.ts
// Purpose: Assemble the desktop in-app browser runtime and expose its stable public API.
// Layer: Desktop runtime manager

import type { BrowserWindow } from "electron";
import type {
  BrowserAttachWebviewInput,
  BrowserCaptureScreenshotResult,
  BrowserDetachWebviewInput,
  BrowserExecuteCdpInput,
  BrowserNavigateInput,
  BrowserNewTabInput,
  BrowserOpenInput,
  BrowserSetPanelBoundsInput,
  BrowserTabInput,
  BrowserThreadInput,
  ThreadBrowserState,
} from "@agent-group/contracts";

import { BrowserAutomationController } from "./browser-manager/automationController";
import type {
  BrowserPerformanceSnapshot,
  BrowserUseCdpEvent,
  BrowserUseSnapshot,
} from "./browser-manager/contracts";
import { BrowserOAuthPopupController } from "./browser-manager/oauthPopups";
import { BrowserPageLoader } from "./browser-manager/pageLoading";
import { BrowserRuntimeRegistry } from "./browser-manager/runtimeRegistry";
import { BrowserRuntimeStateSync } from "./browser-manager/runtimeStateSync";
import { BrowserSessionIdentity } from "./browser-manager/sessionIdentity";
import { BrowserStateStore } from "./browser-manager/state";
import { BrowserSuspensionPolicy } from "./browser-manager/suspensionPolicy";
import { BrowserTabCommands } from "./browser-manager/tabCommands";
import { BrowserWorkspaceController } from "./browser-manager/workspaceController";

export type { BrowserUseCdpEvent, BrowserUseSnapshot } from "./browser-manager/contracts";

export class DesktopBrowserManager {
  private readonly identity: BrowserSessionIdentity;
  private readonly stateStore: BrowserStateStore;
  private readonly runtimes: BrowserRuntimeRegistry;
  private readonly runtimeSync: BrowserRuntimeStateSync;
  private readonly pageLoader: BrowserPageLoader;
  private readonly suspension: BrowserSuspensionPolicy;
  private readonly popups: BrowserOAuthPopupController;
  private readonly workspace: BrowserWorkspaceController;
  private readonly tabs: BrowserTabCommands;
  private readonly automation: BrowserAutomationController;

  constructor() {
    this.identity = new BrowserSessionIdentity();
    this.stateStore = new BrowserStateStore(() => this.identity.ensureSessionConfigured());
    this.runtimes = new BrowserRuntimeRegistry(this.stateStore, {
      resolveSpoofedUserAgent: () => this.identity.resolveSpoofedUserAgent(),
      buildOAuthPopupWindowOptions: () => this.popups.buildWindowOptions(),
      registerOAuthPopupWindow: (popup, context) => this.popups.register(popup, context),
      openNewTab: (threadId, url) => {
        this.tabs.newTab({ threadId, url, activate: true });
      },
      getVisibleBoundsForThread: (threadId) => this.runtimes.getVisibleBoundsForThread(threadId),
      isActiveThread: (threadId) => this.runtimes.isActiveThread(threadId),
      attachActiveTab: (threadId, bounds) => this.workspace.attachActiveTab(threadId, bounds),
      updatePopupWindowsForThread: (threadId) => this.popups.updateForThread(threadId),
      copyTabLink: (threadId, tabId) => this.automation.copyTabLink(threadId, tabId),
      queueRuntimeStateSync: (threadId, tabId, faviconUrls) =>
        this.runtimeSync.queue(threadId, tabId, faviconUrls),
      destroyRuntime: (threadId, tabId) => this.runtimes.destroyRuntime(threadId, tabId),
      clearTabSuspendTimer: (threadId, tabId) =>
        this.suspension.clearTabSuspendTimer(threadId, tabId),
      clearPendingRuntimeSync: (key) => this.runtimeSync.clear(key),
      closeAllPopupWindows: () => this.popups.closeAll(),
    });
    this.runtimeSync = new BrowserRuntimeStateSync(this.stateStore, this.runtimes);
    this.pageLoader = new BrowserPageLoader(this.stateStore, this.runtimes, this.runtimeSync);
    this.suspension = new BrowserSuspensionPolicy(this.stateStore, this.runtimes, this.pageLoader);
    this.popups = new BrowserOAuthPopupController(this.identity, {
      getParentWindow: () => this.runtimes.getWindow(),
      openNewTab: (threadId, url) => {
        this.tabs.newTab({ threadId, url, activate: true });
      },
      getVisibleBoundsForThread: (threadId) => this.runtimes.getVisibleBoundsForThread(threadId),
      isActiveThread: (threadId) => this.runtimes.isActiveThread(threadId),
      attachActiveTab: (threadId, bounds) => this.workspace.attachActiveTab(threadId, bounds),
    });
    this.workspace = new BrowserWorkspaceController(
      this.stateStore,
      this.runtimes,
      this.runtimeSync,
      this.suspension,
      this.pageLoader,
      this.popups,
      { navigate: (input) => this.tabs.navigate(input) },
    );
    this.tabs = new BrowserTabCommands(
      this.stateStore,
      this.runtimes,
      this.suspension,
      this.pageLoader,
      this.popups,
      this.workspace,
    );
    this.automation = new BrowserAutomationController(
      this.stateStore,
      this.runtimes,
      this.runtimeSync,
      this.suspension,
      this.pageLoader,
      this.workspace,
    );
  }

  setWindow(window: BrowserWindow | null): void {
    this.runtimes.setWindow(window);
  }

  subscribe(listener: (state: ThreadBrowserState) => void): () => void {
    return this.stateStore.subscribe(listener);
  }

  subscribeCopyLink(
    listener: (event: import("@agent-group/contracts").BrowserCopyLinkEvent) => void,
  ): () => void {
    return this.stateStore.subscribeCopyLink(listener);
  }

  dispose(): void {
    this.suspension.dispose();
    this.runtimes.dispose();
    this.popups.closeAll();
    this.runtimeSync.dispose();
    this.stateStore.dispose();
  }

  getPerformanceSnapshot(): BrowserPerformanceSnapshot {
    this.stateStore.perfCounters.warmInactiveRuntimeCount =
      this.suspension.countWarmInactiveRuntimes();
    return {
      counters: { ...this.stateStore.perfCounters },
      trackedProcessIds: this.runtimes.getTrackedProcessIds(),
    };
  }

  getBrowserUseSnapshot(): BrowserUseSnapshot | null {
    const activeThreadId = this.runtimes.getActiveThreadId();
    if (activeThreadId) {
      const activeState = this.stateStore.states.get(activeThreadId);
      if (activeState?.open) {
        return {
          threadId: activeThreadId,
          state: this.stateStore.snapshotThreadState(activeThreadId, activeState),
        };
      }
    }

    for (const [threadId, state] of this.stateStore.states) {
      if (state.open) {
        return { threadId, state: this.stateStore.snapshotThreadState(threadId, state) };
      }
    }
    return null;
  }

  open(input: BrowserOpenInput): ThreadBrowserState {
    return this.workspace.open(input);
  }

  close(input: BrowserThreadInput): ThreadBrowserState {
    return this.workspace.close(input);
  }

  hide(input: BrowserThreadInput): void {
    this.workspace.hide(input);
  }

  getState(input: BrowserThreadInput): ThreadBrowserState {
    return this.workspace.getState(input);
  }

  setPanelBounds(input: BrowserSetPanelBoundsInput): void {
    this.workspace.setPanelBounds(input);
  }

  attachWebview(input: BrowserAttachWebviewInput): ThreadBrowserState {
    return this.workspace.attachWebview(input);
  }

  detachWebview(input: BrowserDetachWebviewInput): void {
    this.workspace.detachWebview(input);
  }

  navigate(input: BrowserNavigateInput): ThreadBrowserState {
    return this.tabs.navigate(input);
  }

  reload(input: BrowserTabInput): ThreadBrowserState {
    return this.tabs.reload(input);
  }

  goBack(input: BrowserTabInput): ThreadBrowserState {
    return this.tabs.goBack(input);
  }

  goForward(input: BrowserTabInput): ThreadBrowserState {
    return this.tabs.goForward(input);
  }

  newTab(input: BrowserNewTabInput): ThreadBrowserState {
    return this.tabs.newTab(input);
  }

  closeTab(input: BrowserTabInput): ThreadBrowserState {
    return this.tabs.closeTab(input);
  }

  selectTab(input: BrowserTabInput): ThreadBrowserState {
    return this.tabs.selectTab(input);
  }

  openDevTools(input: BrowserTabInput): void {
    this.tabs.openDevTools(input);
  }

  captureScreenshot(input: BrowserTabInput): Promise<BrowserCaptureScreenshotResult> {
    return this.automation.captureScreenshot(input);
  }

  copyLink(input: BrowserTabInput): void {
    this.automation.copyLink(input);
  }

  copyScreenshotToClipboard(input: BrowserTabInput): Promise<void> {
    return this.automation.copyScreenshotToClipboard(input);
  }

  executeCdp(input: BrowserExecuteCdpInput): Promise<unknown> {
    return this.automation.executeCdp(input);
  }

  attachBrowserUseTab(input: BrowserTabInput): Promise<void> {
    return this.automation.attachBrowserUseTab(input);
  }

  subscribeToCdpEvents(
    input: BrowserTabInput,
    listener: (event: BrowserUseCdpEvent) => void,
  ): () => void {
    return this.automation.subscribeToCdpEvents(input, listener);
  }
}
