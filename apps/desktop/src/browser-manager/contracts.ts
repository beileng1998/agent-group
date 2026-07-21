// FILE: browser-manager/contracts.ts
// Purpose: Internal contracts for the desktop browser manager runtime.
// Layer: Desktop browser runtime

import type { BrowserWindow, WebContents, WebContentsView } from "electron";
import type {
  BrowserCopyLinkEvent,
  BrowserPanelBounds,
  BrowserTabState,
  ThreadBrowserState,
  ThreadId,
} from "@agent-group/contracts";

export const BROWSER_SESSION_PARTITION = "persist:agent-group-browser";
export const BROWSER_INACTIVE_TAB_SUSPEND_DELAY_MS = 1_500;
export const BROWSER_INACTIVE_TAB_SUSPEND_DELAY_PRESSURED_MS = 400;
export const BROWSER_MAX_WARM_INACTIVE_RUNTIMES_PER_THREAD = 1;
export const BROWSER_THREAD_SUSPEND_DELAY_MS = 30_000;
export const BROWSER_ERROR_ABORTED = -3;

export const LIVE_TAB_STATUS: BrowserTabState["status"] = "live";
export const SUSPENDED_TAB_STATUS: BrowserTabState["status"] = "suspended";

export type BrowserStateListener = (state: ThreadBrowserState) => void;
export type BrowserCopyLinkListener = (event: BrowserCopyLinkEvent) => void;

export interface LiveTabRuntime {
  key: string;
  threadId: ThreadId;
  tabId: string;
  webContents: WebContents;
  view: WebContentsView | null;
  ownsWebContents: boolean;
  listenerDisposers: Array<() => void>;
}

export interface OAuthPopupContext {
  threadId: ThreadId;
  tabId: string;
}

export interface OAuthPopupRuntime extends OAuthPopupContext {
  window: BrowserWindow;
  listenerDisposers: Array<() => void>;
}

export interface NativeBrowserViewVisibility {
  setVisible?: (visible: boolean) => void;
}

export interface PendingRuntimeSync {
  threadId: ThreadId;
  tabId: string;
  faviconUrls?: string[];
}

export interface BrowserPerformanceCounters {
  setPanelBoundsCalls: number;
  setPanelBoundsNoopSkips: number;
  setPanelBoundsViewportUpdates: number;
  stateEmitCalls: number;
  stateEmitSkips: number;
  stateCloneCount: number;
  runtimeSyncQueueFlushes: number;
  syncRuntimeStateCalls: number;
  inactiveTabSuspendScheduled: number;
  inactiveTabSuspendCancelled: number;
  inactiveTabBudgetEvictions: number;
  warmInactiveRuntimeCount: number;
}

export interface BrowserPerformanceSnapshot {
  counters: BrowserPerformanceCounters;
  trackedProcessIds: number[];
}

export interface BrowserUseSnapshot {
  threadId: ThreadId;
  state: ThreadBrowserState;
}

export interface BrowserUseCdpEvent {
  method: string;
  params?: unknown;
}

export interface BrowserRuntimeEventCallbacks {
  resolveSpoofedUserAgent(): string;
  buildOAuthPopupWindowOptions(): Electron.BrowserWindowConstructorOptions;
  registerOAuthPopupWindow(popup: BrowserWindow, context: OAuthPopupContext): void;
  openNewTab(threadId: ThreadId, url: string): void;
  getVisibleBoundsForThread(threadId: ThreadId): BrowserPanelBounds | null;
  isActiveThread(threadId: ThreadId): boolean;
  attachActiveTab(threadId: ThreadId, bounds: BrowserPanelBounds): void;
  updatePopupWindowsForThread(threadId: ThreadId): void;
  copyTabLink(threadId: ThreadId, tabId: string): void;
  queueRuntimeStateSync(threadId: ThreadId, tabId: string, faviconUrls?: string[]): void;
  destroyRuntime(threadId: ThreadId, tabId: string): void;
}

export function createPerformanceCounters(): BrowserPerformanceCounters {
  return {
    setPanelBoundsCalls: 0,
    setPanelBoundsNoopSkips: 0,
    setPanelBoundsViewportUpdates: 0,
    stateEmitCalls: 0,
    stateEmitSkips: 0,
    stateCloneCount: 0,
    runtimeSyncQueueFlushes: 0,
    syncRuntimeStateCalls: 0,
    inactiveTabSuspendScheduled: 0,
    inactiveTabSuspendCancelled: 0,
    inactiveTabBudgetEvictions: 0,
    warmInactiveRuntimeCount: 0,
  };
}
