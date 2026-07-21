// FILE: browser-manager/runtimeEvents.ts
// Purpose: Wire WebContents lifecycle events to durable browser state transitions.
// Layer: Desktop browser runtime

import { BrowserWindow, shell } from "electron";
import {
  BROWSER_BLANK_URL as ABOUT_BLANK_URL,
  classifyBrowserWindowOpen,
} from "@agent-group/shared/browserSession";
import { isBrowserCopyLinkChord } from "@agent-group/shared/browserShortcuts";

import {
  BROWSER_ERROR_ABORTED,
  type BrowserRuntimeEventCallbacks,
  type LiveTabRuntime,
} from "./contracts";
import type { BrowserStateStore } from "./state";
import { defaultTitleForUrl, mapBrowserLoadError, syncThreadLastError } from "./state";

export function configureRuntimeWebContents(
  runtime: LiveTabRuntime,
  stateStore: BrowserStateStore,
  callbacks: BrowserRuntimeEventCallbacks,
): void {
  const { threadId, tabId, webContents } = runtime;

  webContents.setUserAgent(callbacks.resolveSpoofedUserAgent());
  webContents.setWindowOpenHandler((details) => {
    const { url } = details;
    const isWebUrl =
      url.startsWith("http://") || url.startsWith("https://") || url === ABOUT_BLANK_URL;
    if (!isWebUrl) {
      void shell.openExternal(url);
      return { action: "deny" };
    }

    const kind = classifyBrowserWindowOpen({
      url,
      frameName: details.frameName,
      features: details.features,
      disposition: details.disposition,
    });
    if (kind === "popup") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: callbacks.buildOAuthPopupWindowOptions(),
      };
    }

    callbacks.openNewTab(threadId, url);
    const bounds = callbacks.getVisibleBoundsForThread(threadId);
    if (callbacks.isActiveThread(threadId) && bounds) {
      callbacks.attachActiveTab(threadId, bounds);
    }
    return { action: "deny" };
  });

  const didCreateWindow = (childWindow: BrowserWindow) => {
    callbacks.registerOAuthPopupWindow(childWindow, { threadId, tabId });
  };
  webContents.on("did-create-window", didCreateWindow);
  runtime.listenerDisposers.push(() => {
    webContents.removeListener("did-create-window", didCreateWindow);
  });

  const beforeInputEvent = (event: Electron.Event, input: Electron.Input) => {
    if (input.type !== "keyDown") return;
    const matches = isBrowserCopyLinkChord(
      {
        meta: input.meta,
        ctrl: input.control,
        shift: input.shift,
        alt: input.alt,
        key: input.key,
      },
      process.platform === "darwin",
    );
    if (!matches) return;
    event.preventDefault();
    callbacks.copyTabLink(threadId, tabId);
  };
  webContents.on("before-input-event", beforeInputEvent);
  runtime.listenerDisposers.push(() => {
    webContents.removeListener("before-input-event", beforeInputEvent);
  });

  const pageTitleUpdated = (event: Electron.Event) => {
    event.preventDefault();
    callbacks.queueRuntimeStateSync(threadId, tabId);
  };
  webContents.on("page-title-updated", pageTitleUpdated);
  runtime.listenerDisposers.push(() => {
    webContents.removeListener("page-title-updated", pageTitleUpdated);
  });

  const pageFaviconUpdated = (_event: Electron.Event, faviconUrls: string[]) => {
    callbacks.queueRuntimeStateSync(threadId, tabId, faviconUrls);
  };
  webContents.on("page-favicon-updated", pageFaviconUpdated);
  runtime.listenerDisposers.push(() => {
    webContents.removeListener("page-favicon-updated", pageFaviconUpdated);
  });

  const queueSync = () => callbacks.queueRuntimeStateSync(threadId, tabId);
  webContents.on("did-start-loading", queueSync);
  runtime.listenerDisposers.push(() => {
    webContents.removeListener("did-start-loading", queueSync);
  });
  webContents.on("did-stop-loading", queueSync);
  runtime.listenerDisposers.push(() => {
    webContents.removeListener("did-stop-loading", queueSync);
  });
  webContents.on("did-navigate", queueSync);
  runtime.listenerDisposers.push(() => {
    webContents.removeListener("did-navigate", queueSync);
  });
  webContents.on("did-navigate-in-page", queueSync);
  runtime.listenerDisposers.push(() => {
    webContents.removeListener("did-navigate-in-page", queueSync);
  });

  const didFailLoad = (
    _event: Electron.Event,
    errorCode: number,
    _errorDescription: string,
    validatedURL: string,
    isMainFrame: boolean,
  ) => {
    if (!isMainFrame || errorCode === BROWSER_ERROR_ABORTED) return;
    const state = stateStore.states.get(threadId);
    const tab = state ? stateStore.getTab(state, tabId) : null;
    if (!state || !tab) return;

    tab.url = validatedURL || tab.url;
    tab.title = defaultTitleForUrl(tab.url);
    tab.isLoading = false;
    tab.lastError = mapBrowserLoadError(errorCode);
    syncThreadLastError(state);
    stateStore.markThreadStateChanged(threadId);
    stateStore.emitState(threadId);
  };
  webContents.on("did-fail-load", didFailLoad);
  runtime.listenerDisposers.push(() => {
    webContents.removeListener("did-fail-load", didFailLoad);
  });

  const renderProcessGone = () => {
    const state = stateStore.states.get(threadId);
    const tab = state ? stateStore.getTab(state, tabId) : null;
    callbacks.destroyRuntime(threadId, tabId);
    if (state && tab) {
      tab.status = "suspended";
      tab.isLoading = false;
      tab.lastError = "This tab stopped unexpectedly.";
      syncThreadLastError(state);
      stateStore.markThreadStateChanged(threadId);
      stateStore.emitState(threadId);
    }
    const bounds = callbacks.getVisibleBoundsForThread(threadId);
    if (callbacks.isActiveThread(threadId) && bounds) {
      callbacks.attachActiveTab(threadId, bounds);
    }
  };
  webContents.on("render-process-gone", renderProcessGone);
  runtime.listenerDisposers.push(() => {
    webContents.removeListener("render-process-gone", renderProcessGone);
  });
}
