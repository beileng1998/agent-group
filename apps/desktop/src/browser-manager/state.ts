// FILE: browser-manager/state.ts
// Purpose: Own durable browser thread state and pure browser state transitions.
// Layer: Desktop browser runtime

import * as Crypto from "node:crypto";

import type { WebContents } from "electron";
import type {
  BrowserCopyLinkEvent,
  BrowserPanelBounds,
  BrowserTabState,
  ThreadBrowserState,
  ThreadId,
} from "@agent-group/contracts";
import {
  BROWSER_BLANK_URL as ABOUT_BLANK_URL,
  normalizeBrowserUrlInput as normalizeUrlInput,
} from "@agent-group/shared/browserSession";

import {
  createPerformanceCounters,
  LIVE_TAB_STATUS,
  SUSPENDED_TAB_STATUS,
  type BrowserCopyLinkListener,
  type BrowserPerformanceCounters,
  type BrowserStateListener,
} from "./contracts";

export class BrowserStateStore {
  readonly states = new Map<ThreadId, ThreadBrowserState>();
  readonly perfCounters: BrowserPerformanceCounters = createPerformanceCounters();

  private readonly threadVersionById = new Map<ThreadId, number>();
  private readonly snapshotCacheByThreadId = new Map<
    ThreadId,
    { version: number; snapshot: ThreadBrowserState }
  >();
  private readonly lastEmittedVersionByThreadId = new Map<ThreadId, number>();
  private readonly listeners = new Set<BrowserStateListener>();
  private readonly copyLinkListeners = new Set<BrowserCopyLinkListener>();

  constructor(private readonly beforeEnsureWorkspace: () => void) {}

  subscribe(listener: BrowserStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeCopyLink(listener: BrowserCopyLinkListener): () => void {
    this.copyLinkListeners.add(listener);
    return () => {
      this.copyLinkListeners.delete(listener);
    };
  }

  emitCopyLink(event: BrowserCopyLinkEvent): void {
    for (const listener of this.copyLinkListeners) {
      listener(event);
    }
  }

  dispose(): void {
    this.listeners.clear();
    this.copyLinkListeners.clear();
    this.states.clear();
    this.threadVersionById.clear();
    this.snapshotCacheByThreadId.clear();
    this.lastEmittedVersionByThreadId.clear();
  }

  getOrCreateState(threadId: ThreadId): ThreadBrowserState {
    const existing = this.states.get(threadId);
    if (existing) {
      return existing;
    }

    const initial = defaultThreadBrowserState(threadId);
    this.states.set(threadId, initial);
    this.threadVersionById.set(threadId, 0);
    return initial;
  }

  ensureWorkspace(threadId: ThreadId, initialUrl?: string): ThreadBrowserState {
    this.beforeEnsureWorkspace();
    const state = this.getOrCreateState(threadId);
    if (state.tabs.length === 0) {
      const initialTab = createBrowserTab(normalizeUrlInput(initialUrl));
      state.tabs = [initialTab];
      state.activeTabId = initialTab.id;
    }

    if (!state.activeTabId || !state.tabs.some((tab) => tab.id === state.activeTabId)) {
      state.activeTabId = state.tabs[0]?.id ?? null;
    }

    return state;
  }

  resolveTab(state: ThreadBrowserState, tabId?: string): BrowserTabState {
    const resolvedTabId = tabId ?? state.activeTabId;
    const existing =
      (resolvedTabId ? state.tabs.find((tab) => tab.id === resolvedTabId) : undefined) ??
      state.tabs[0];
    if (existing) {
      return existing;
    }

    const fallback = createBrowserTab();
    state.tabs = [fallback];
    state.activeTabId = fallback.id;
    return fallback;
  }

  getActiveTab(state: ThreadBrowserState): BrowserTabState | null {
    if (!state.activeTabId) {
      return state.tabs[0] ?? null;
    }
    return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0] ?? null;
  }

  getTab(state: ThreadBrowserState, tabId: string): BrowserTabState | null {
    return state.tabs.find((tab) => tab.id === tabId) ?? null;
  }

  markThreadStateChanged(threadId: ThreadId): void {
    const nextVersion = (this.threadVersionById.get(threadId) ?? 0) + 1;
    this.threadVersionById.set(threadId, nextVersion);
    const state = this.states.get(threadId);
    if (state) {
      state.version = nextVersion;
    }
  }

  snapshotThreadState(
    threadId: ThreadId,
    state = this.getOrCreateState(threadId),
  ): ThreadBrowserState {
    const version = state.version;
    const cached = this.snapshotCacheByThreadId.get(threadId);
    if (cached && cached.version === version) {
      return cached.snapshot;
    }

    const snapshot = cloneThreadState(state);
    this.perfCounters.stateCloneCount += 1;
    this.snapshotCacheByThreadId.set(threadId, { version, snapshot });
    return snapshot;
  }

  forgetLastEmittedVersion(threadId: ThreadId): void {
    this.lastEmittedVersionByThreadId.delete(threadId);
  }

  emitState(threadId: ThreadId): void {
    this.perfCounters.stateEmitCalls += 1;
    const state = this.getOrCreateState(threadId);
    const nextVersion = state.version;
    if (this.lastEmittedVersionByThreadId.get(threadId) === nextVersion) {
      this.perfCounters.stateEmitSkips += 1;
      return;
    }
    this.lastEmittedVersionByThreadId.set(threadId, nextVersion);
    const snapshot = this.snapshotThreadState(threadId, state);
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export function createBrowserTab(url = ABOUT_BLANK_URL): BrowserTabState {
  return {
    id: Crypto.randomUUID(),
    url,
    title: defaultTitleForUrl(url),
    status: SUSPENDED_TAB_STATUS,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    faviconUrl: null,
    lastCommittedUrl: null,
    lastError: null,
  };
}

function defaultThreadBrowserState(threadId: ThreadId): ThreadBrowserState {
  return {
    threadId,
    version: 0,
    open: false,
    activeTabId: null,
    tabs: [],
    lastError: null,
  };
}

function cloneThreadState(state: ThreadBrowserState): ThreadBrowserState {
  return { ...state, tabs: state.tabs.map((tab) => ({ ...tab })) };
}

export function defaultTitleForUrl(url: string): string {
  if (url === ABOUT_BLANK_URL) {
    return "New tab";
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname || url;
  } catch {
    return url;
  }
}

export function screenshotFileNameForUrl(url: string): string {
  const fallback = "browser";
  try {
    const hostname = new URL(url).hostname.trim().toLowerCase();
    const normalizedHost = hostname.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `${normalizedHost || fallback}-${Date.now()}.png`;
  } catch {
    return `${fallback}-${Date.now()}.png`;
  }
}

export function normalizeBounds(bounds: BrowserPanelBounds | null): BrowserPanelBounds | null {
  if (!bounds) return null;
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height)
  ) {
    return null;
  }
  const width = Math.max(0, Math.floor(bounds.width));
  const height = Math.max(0, Math.floor(bounds.height));
  if (width === 0 || height === 0) return null;
  return {
    x: Math.max(0, Math.floor(bounds.x)),
    y: Math.max(0, Math.floor(bounds.y)),
    width,
    height,
  };
}

export function isAbortedNavigationError(error: unknown): boolean {
  return error instanceof Error && /ERR_ABORTED|\(-3\)/i.test(error.message);
}

export function mapBrowserLoadError(errorCode: number): string {
  switch (errorCode) {
    case -102:
      return "Connection refused.";
    case -105:
      return "Couldn't resolve this address.";
    case -106:
      return "You're offline.";
    case -118:
      return "This page took too long to respond.";
    case -137:
    case -200:
      return "A secure connection couldn't be established.";
    default:
      return "Couldn't open this page.";
  }
}

export function buildRuntimeKey(threadId: ThreadId, tabId: string): string {
  return `${threadId}:${tabId}`;
}

export function browserBoundsSignature(bounds: BrowserPanelBounds | null): string {
  return bounds ? `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}` : "hidden";
}

export function withRequestHeadersCaseInsensitive(
  headers: Record<string, string>,
  replacements: Record<string, string>,
): Record<string, string> {
  const replacementNamesByLower = new Set(
    Object.keys(replacements).map((name) => name.toLowerCase()),
  );
  for (const existing of Object.keys(headers)) {
    if (replacementNamesByLower.has(existing.toLowerCase())) delete headers[existing];
  }
  for (const [name, value] of Object.entries(replacements)) headers[name] = value;
  return headers;
}

function setIfChanged<T>(current: T, next: T, apply: (value: T) => void): boolean {
  if (Object.is(current, next)) return false;
  apply(next);
  return true;
}

export function suspendTabState(tab: BrowserTabState): boolean {
  let didChange = false;
  didChange =
    setIfChanged(tab.status, SUSPENDED_TAB_STATUS, (value) => (tab.status = value)) || didChange;
  didChange = setIfChanged(tab.isLoading, false, (value) => (tab.isLoading = value)) || didChange;
  didChange = setIfChanged(tab.canGoBack, false, (value) => (tab.canGoBack = value)) || didChange;
  didChange =
    setIfChanged(tab.canGoForward, false, (value) => (tab.canGoForward = value)) || didChange;
  return didChange;
}

export function syncTabStateFromRuntime(
  state: ThreadBrowserState,
  tab: BrowserTabState,
  webContents: WebContents,
  faviconUrls?: string[],
): boolean {
  const currentUrl = webContents.getURL();
  const nextUrl = currentUrl || tab.url;
  const nextTitle = webContents.getTitle();
  let didChange = false;
  didChange =
    setIfChanged(tab.status, LIVE_TAB_STATUS, (value) => (tab.status = value)) || didChange;
  didChange = setIfChanged(tab.url, nextUrl, (value) => (tab.url = value)) || didChange;
  const title =
    !nextTitle || nextTitle === ABOUT_BLANK_URL ? defaultTitleForUrl(nextUrl) : nextTitle;
  didChange = setIfChanged(tab.title, title, (value) => (tab.title = value)) || didChange;
  didChange =
    setIfChanged(tab.isLoading, webContents.isLoading(), (value) => (tab.isLoading = value)) ||
    didChange;
  didChange =
    setIfChanged(
      tab.canGoBack,
      canWebContentsGoBack(webContents),
      (value) => (tab.canGoBack = value),
    ) || didChange;
  didChange =
    setIfChanged(
      tab.canGoForward,
      canWebContentsGoForward(webContents),
      (value) => (tab.canGoForward = value),
    ) || didChange;
  didChange =
    setIfChanged(
      tab.lastCommittedUrl,
      currentUrl || tab.lastCommittedUrl,
      (value) => (tab.lastCommittedUrl = value),
    ) || didChange;
  if (faviconUrls) {
    didChange =
      setIfChanged(
        tab.faviconUrl,
        faviconUrls[0] ?? tab.faviconUrl,
        (value) => (tab.faviconUrl = value),
      ) || didChange;
  }
  if (tab.lastError && !tab.isLoading) {
    tab.lastError = null;
    didChange = true;
  }
  return syncThreadLastError(state) || didChange;
}

export function canWebContentsGoBack(webContents: WebContents): boolean {
  return webContents.navigationHistory?.canGoBack() ?? webContents.canGoBack();
}

export function canWebContentsGoForward(webContents: WebContents): boolean {
  return webContents.navigationHistory?.canGoForward() ?? webContents.canGoForward();
}

export function syncThreadLastError(state: ThreadBrowserState): boolean {
  const activeTab =
    (state.activeTabId ? state.tabs.find((tab) => tab.id === state.activeTabId) : undefined) ??
    state.tabs[0];
  const nextLastError = activeTab?.lastError ?? null;
  if (state.lastError === nextLastError) return false;
  state.lastError = nextLastError;
  return true;
}
