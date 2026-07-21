// FILE: fallbackBrowserApi.ts
// Purpose: Implements the NativeApi browser surface for desktop and browser fallback modes.
// Layer: Web transport adapter

import type { NativeApi, ThreadBrowserState, ThreadId } from "@agent-group/contracts";

const fallbackBrowserStateListeners = new Set<(state: ThreadBrowserState) => void>();
const fallbackBrowserStates = new Map<ThreadId, ThreadBrowserState>();

function defaultBrowserState(threadId: ThreadId): ThreadBrowserState {
  return {
    threadId,
    version: 0,
    open: false,
    activeTabId: null,
    tabs: [],
    lastError: null,
  };
}

function defaultBrowserTitle(url: string): string {
  if (url === "about:blank") {
    return "New tab";
  }
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function createFallbackTab(url = "about:blank") {
  return {
    id: crypto.randomUUID(),
    url,
    title: defaultBrowserTitle(url),
    status: "live" as const,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    faviconUrl: null,
    lastCommittedUrl: url,
    lastError: null,
  };
}

function cloneBrowserState(state: ThreadBrowserState): ThreadBrowserState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => ({ ...tab })),
  };
}

function getFallbackBrowserState(threadId: ThreadId): ThreadBrowserState {
  const existing = fallbackBrowserStates.get(threadId);
  if (existing) {
    return existing;
  }
  const initial = defaultBrowserState(threadId);
  fallbackBrowserStates.set(threadId, initial);
  return initial;
}

function emitFallbackBrowserState(threadId: ThreadId): ThreadBrowserState {
  const state = cloneBrowserState(getFallbackBrowserState(threadId));
  for (const listener of fallbackBrowserStateListeners) {
    listener(state);
  }
  return state;
}

function ensureFallbackBrowserWorkspace(threadId: ThreadId): ThreadBrowserState {
  const state = getFallbackBrowserState(threadId);
  if (state.tabs.length === 0) {
    const tab = createFallbackTab();
    state.tabs = [tab];
    state.activeTabId = tab.id;
  }
  state.open = true;
  return state;
}

function resolveFallbackBrowserTab(state: ThreadBrowserState, tabId?: string) {
  const existing =
    (tabId ? state.tabs.find((tab) => tab.id === tabId) : undefined) ??
    (state.activeTabId ? state.tabs.find((tab) => tab.id === state.activeTabId) : undefined) ??
    state.tabs[0];
  if (existing) {
    return existing;
  }
  const tab = createFallbackTab();
  state.tabs = [tab];
  state.activeTabId = tab.id;
  state.open = true;
  return tab;
}

function changed(state: ThreadBrowserState): void {
  state.version += 1;
}

export function createBrowserApi(): NativeApi["browser"] {
  return {
    open: async (input) => {
      if (window.desktopBridge) return window.desktopBridge.browser.open(input);
      const state = ensureFallbackBrowserWorkspace(input.threadId);
      if (input.initialUrl && state.tabs.length > 0) {
        const activeTab = resolveFallbackBrowserTab(state);
        activeTab.url = input.initialUrl;
        activeTab.title = defaultBrowserTitle(input.initialUrl);
        activeTab.lastCommittedUrl = input.initialUrl;
      }
      changed(state);
      return emitFallbackBrowserState(input.threadId);
    },
    close: async (input) => {
      if (window.desktopBridge) return window.desktopBridge.browser.close(input);
      const state = getFallbackBrowserState(input.threadId);
      state.open = false;
      state.activeTabId = null;
      state.tabs = [];
      state.lastError = null;
      changed(state);
      return emitFallbackBrowserState(input.threadId);
    },
    hide: async (input) => {
      if (window.desktopBridge) await window.desktopBridge.browser.hide(input);
    },
    getState: async (input) => {
      if (window.desktopBridge) return window.desktopBridge.browser.getState(input);
      return cloneBrowserState(getFallbackBrowserState(input.threadId));
    },
    setPanelBounds: async (input) => {
      if (window.desktopBridge) await window.desktopBridge.browser.setPanelBounds(input);
    },
    attachWebview: async (input) => {
      if (window.desktopBridge) return window.desktopBridge.browser.attachWebview(input);
      return cloneBrowserState(getFallbackBrowserState(input.threadId));
    },
    detachWebview: async (input) => {
      if (window.desktopBridge) await window.desktopBridge.browser.detachWebview(input);
    },
    copyLink: async (input) => {
      if (window.desktopBridge) return window.desktopBridge.browser.copyLink(input);
      throw new Error("Copying the browser link requires the desktop app.");
    },
    copyScreenshotToClipboard: async (input) => {
      if (window.desktopBridge) {
        await window.desktopBridge.browser.copyScreenshotToClipboard(input);
        return;
      }
      throw new Error("Browser screenshots require the desktop app.");
    },
    captureScreenshot: async (input) => {
      if (window.desktopBridge) return window.desktopBridge.browser.captureScreenshot(input);
      throw new Error("Browser screenshots require the desktop app.");
    },
    executeCdp: async (input) => {
      if (window.desktopBridge) return window.desktopBridge.browser.executeCdp(input);
      throw new Error("Browser automation requires the desktop app.");
    },
    navigate: async (input) => {
      if (window.desktopBridge) return window.desktopBridge.browser.navigate(input);
      const state = ensureFallbackBrowserWorkspace(input.threadId);
      const tab = resolveFallbackBrowserTab(state, input.tabId);
      tab.url = input.url;
      tab.title = defaultBrowserTitle(input.url);
      tab.lastCommittedUrl = input.url;
      tab.lastError = null;
      tab.status = "live";
      state.activeTabId = tab.id;
      changed(state);
      return emitFallbackBrowserState(input.threadId);
    },
    reload: async (input) => {
      if (window.desktopBridge) return window.desktopBridge.browser.reload(input);
      return cloneBrowserState(getFallbackBrowserState(input.threadId));
    },
    goBack: async (input) => {
      if (window.desktopBridge) return window.desktopBridge.browser.goBack(input);
      return cloneBrowserState(getFallbackBrowserState(input.threadId));
    },
    goForward: async (input) => {
      if (window.desktopBridge) return window.desktopBridge.browser.goForward(input);
      return cloneBrowserState(getFallbackBrowserState(input.threadId));
    },
    newTab: async (input) => {
      if (window.desktopBridge) return window.desktopBridge.browser.newTab(input);
      const state = ensureFallbackBrowserWorkspace(input.threadId);
      const tab = createFallbackTab(input.url);
      state.tabs = [...state.tabs, tab];
      if (input.activate !== false || !state.activeTabId) state.activeTabId = tab.id;
      changed(state);
      return emitFallbackBrowserState(input.threadId);
    },
    closeTab: async (input) => {
      if (window.desktopBridge) return window.desktopBridge.browser.closeTab(input);
      const state = ensureFallbackBrowserWorkspace(input.threadId);
      const nextTabs = state.tabs.filter((tab) => tab.id !== input.tabId);
      if (nextTabs.length === state.tabs.length) return cloneBrowserState(state);
      state.tabs = nextTabs;
      if (nextTabs.length === 0) {
        const replacementTab = createFallbackTab();
        state.tabs = [replacementTab];
        state.activeTabId = replacementTab.id;
        state.lastError = null;
      } else if (!state.tabs.some((tab) => tab.id === state.activeTabId)) {
        state.activeTabId = state.tabs[0]?.id ?? null;
      }
      changed(state);
      return emitFallbackBrowserState(input.threadId);
    },
    selectTab: async (input) => {
      if (window.desktopBridge) return window.desktopBridge.browser.selectTab(input);
      const state = ensureFallbackBrowserWorkspace(input.threadId);
      const tab = resolveFallbackBrowserTab(state, input.tabId);
      state.activeTabId = tab.id;
      changed(state);
      return emitFallbackBrowserState(input.threadId);
    },
    openDevTools: async (input) => {
      if (window.desktopBridge) await window.desktopBridge.browser.openDevTools(input);
    },
    onState: (callback) => {
      if (window.desktopBridge) return window.desktopBridge.browser.onState(callback);
      fallbackBrowserStateListeners.add(callback);
      return () => {
        fallbackBrowserStateListeners.delete(callback);
      };
    },
    onCopyLink: (callback) => {
      if (window.desktopBridge) return window.desktopBridge.browser.onBrowserCopyLink(callback);
      return () => {};
    },
  };
}

export function resetFallbackBrowserApi(clearStates: boolean): void {
  fallbackBrowserStateListeners.clear();
  if (clearStates) {
    fallbackBrowserStates.clear();
  }
}
