// FILE: useBrowserNativeViewport.ts
// Purpose: Owns the renderer webview and synchronizes its native browser viewport.
// Layer: Desktop-only browser controller

import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { BrowserTabState, NativeApi, ThreadBrowserState, ThreadId } from "@agent-group/contracts";
import { BROWSER_BLANK_URL } from "@agent-group/shared/browserSession";

import { PANEL_RESIZE_OVERLAY_SYNC_EVENT } from "~/lib/panelResize";

import {
  AGENT_GROUP_BROWSER_LABEL,
  BROWSER_BOUNDS_SYNC_BURST_FRAMES,
  BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET,
  BROWSER_PERF_SAMPLE_INTERVAL_MS,
  BROWSER_WEBVIEW_PARTITION,
  type BrowserViewportPerfCounters,
  type BrowserWebviewElement,
  VIEWPORT_TRANSITION_PROPERTIES,
  hasNativeBrowserObscuringOverlay,
  ignoreBrowserBoundsSyncError,
  ignoreBrowserWebviewDetachError,
  isBrowserPerfLoggingEnabled,
  isNativeBrowserTransitionSignalTarget,
  setBrowserWebviewOverlayOcclusion,
} from "../BrowserPanel.nativeViewport";

export interface BrowserActionRunner {
  <T>(action: () => Promise<T>): Promise<T | null>;
}

export interface UseBrowserNativeViewportInput {
  api: NativeApi | undefined;
  activeTab: BrowserTabState | null;
  isLiveRuntime: boolean;
  workspaceReady: boolean;
  showLocalServersHome: boolean;
  threadId: ThreadId;
  runBrowserAction: BrowserActionRunner;
  upsertThreadState: (state: ThreadBrowserState) => void;
}

export interface BrowserNativeViewportController {
  viewportRef: RefObject<HTMLDivElement | null>;
}

export function useBrowserNativeViewport({
  api,
  activeTab,
  isLiveRuntime,
  workspaceReady,
  showLocalServersHome,
  threadId,
  runBrowserAction,
  upsertThreadState,
}: UseBrowserNativeViewportInput): BrowserNativeViewportController {
  const viewportRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<BrowserWebviewElement | null>(null);
  const webviewTabIdRef = useRef<string | null>(null);
  const webviewAttachKeyRef = useRef<string | null>(null);
  const lastSentBoundsRef = useRef<string | null>(null);
  const lastMeasuredBoundsKeyRef = useRef<string | null>(null);
  const lastOverlayObscuredRef = useRef(false);
  const resizeFrameRef = useRef<number | null>(null);
  const boundsBurstFrameRef = useRef<number | null>(null);
  const burstFramesRemainingRef = useRef(0);
  const burstStableFramesRef = useRef(0);
  const perfCountersRef = useRef<BrowserViewportPerfCounters>({
    syncAttempts: 0,
    syncSkips: 0,
    syncSends: 0,
    resizeSchedules: 0,
    resizeScheduleSkips: 0,
    burstStarts: 0,
    burstExtensions: 0,
    burstFrames: 0,
    transitionSignals: 0,
    ignoredTransitionSignals: 0,
  });

  // Renderer-owned <webview>s are adopted by the desktop manager. Always detach before
  // removing the DOM node so main never keeps a stale webContents runtime.
  const detachRendererBrowserWebview = useCallback(() => {
    const webview = webviewRef.current;
    const tabId = webviewTabIdRef.current;

    if (webview && api && isLiveRuntime && tabId) {
      let webContentsId: number | undefined;
      try {
        webContentsId = webview.getWebContentsId?.();
      } catch {
        webContentsId = undefined;
      }
      if (webContentsId && webContentsId > 0) {
        void api.browser
          .detachWebview({ threadId, tabId, webContentsId })
          .catch(ignoreBrowserWebviewDetachError);
      }
    }

    webview?.remove();
    webviewRef.current = null;
    webviewTabIdRef.current = null;
    webviewAttachKeyRef.current = null;
  }, [api, isLiveRuntime, threadId]);

  useLayoutEffect(() => {
    if (!api || !isLiveRuntime || !workspaceReady || !activeTab) {
      return;
    }

    if (showLocalServersHome) {
      detachRendererBrowserWebview();
      return;
    }

    const host = viewportRef.current;
    if (!host) {
      return;
    }

    let webview = webviewRef.current;
    if (!webview) {
      webview = document.createElement("webview") as BrowserWebviewElement;
      webview.className = "h-full w-full";
      webview.style.display = "flex";
      webview.style.width = "100%";
      webview.style.height = "100%";
      webview.style.backgroundColor = "#0d0d0d";
      webview.setAttribute("partition", BROWSER_WEBVIEW_PARTITION);
      webview.setAttribute("webpreferences", "contextIsolation=yes,nodeIntegration=no,sandbox=yes");
      // A <webview> blocks window.open() unless `allowpopups` is set. Without it, clicking
      // "Continue with Google" (and any OAuth/popup flow) is silently dropped before the main
      // process's window-open handler ever runs. Enabling it lets the popup classifier in
      // browserManager decide popup-vs-tab and keep the OAuth `window.opener` handshake alive.
      webview.setAttribute("allowpopups", "true");
      // No `useragent` attribute on purpose: the desktop main process spoofs a desktop Chrome
      // UA on the shared persistent partition, so this webview (and OAuth popups) inherit the
      // same identity. This keeps in-app Google/OAuth sign-in working without duplicating the
      // UA string into the renderer.
      webviewRef.current = webview;
      host.append(webview);
    } else if (webview.parentElement !== host) {
      host.append(webview);
    }

    const initialUrl = activeTab.lastCommittedUrl ?? activeTab.url ?? BROWSER_BLANK_URL;
    if (webviewTabIdRef.current !== activeTab.id) {
      webviewTabIdRef.current = activeTab.id;
      webviewAttachKeyRef.current = null;
      webview.setAttribute("src", initialUrl.length > 0 ? initialUrl : BROWSER_BLANK_URL);
    }

    const attachVisibleWebview = () => {
      let webContentsId: number | undefined;
      try {
        webContentsId = webview.getWebContentsId?.();
      } catch {
        return;
      }
      if (!webContentsId || webContentsId <= 0) {
        return;
      }

      const attachKey = `${activeTab.id}:${webContentsId}`;
      if (webviewAttachKeyRef.current === attachKey) {
        return;
      }
      webviewAttachKeyRef.current = attachKey;
      void runBrowserAction(() =>
        api.browser.attachWebview({
          threadId,
          tabId: activeTab.id,
          webContentsId,
        }),
      ).then((state) => {
        if (state) {
          upsertThreadState(state);
        }
      });
    };

    webview.addEventListener("dom-ready", attachVisibleWebview);
    webview.addEventListener("did-start-loading", attachVisibleWebview);
    window.requestAnimationFrame(attachVisibleWebview);

    return () => {
      webview.removeEventListener("dom-ready", attachVisibleWebview);
      webview.removeEventListener("did-start-loading", attachVisibleWebview);
    };
  }, [
    activeTab,
    api,
    detachRendererBrowserWebview,
    isLiveRuntime,
    runBrowserAction,
    showLocalServersHome,
    threadId,
    upsertThreadState,
    workspaceReady,
  ]);

  useEffect(() => {
    return () => {
      detachRendererBrowserWebview();
    };
  }, [detachRendererBrowserWebview]);

  useEffect(() => {
    if (!isLiveRuntime || !isBrowserPerfLoggingEnabled()) {
      return;
    }

    const intervalId = window.setInterval(() => {
      console.info(`[${AGENT_GROUP_BROWSER_LABEL} panel perf]`, {
        threadId,
        ...perfCountersRef.current,
      });
    }, BROWSER_PERF_SAMPLE_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isLiveRuntime, threadId]);

  useLayoutEffect(() => {
    if (!api || !isLiveRuntime) {
      return;
    }

    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const syncBounds = () => {
      perfCountersRef.current.syncAttempts += 1;
      // While the local-servers home is up, force the browser surface hidden instead of
      // trusting the obscuring-overlay heuristic. The native/inline webview otherwise paints
      // about:blank white over our dark DOM home — the "always white" empty state.
      const obscuredByOverlay = showLocalServersHome || hasNativeBrowserObscuringOverlay(element);
      lastOverlayObscuredRef.current = obscuredByOverlay;
      setBrowserWebviewOverlayOcclusion(webviewRef.current, obscuredByOverlay);
      const rect = element.getBoundingClientRect();
      const bounds = obscuredByOverlay
        ? null
        : (() => {
            if (rect.width <= 0 || rect.height <= 0) {
              return null;
            }
            return {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
            };
          })();
      const nextKey = bounds
        ? `renderer:${Math.round(bounds.x)}:${Math.round(bounds.y)}:${Math.round(bounds.width)}:${Math.round(bounds.height)}`
        : "renderer:hidden";
      lastMeasuredBoundsKeyRef.current = nextKey;
      if (lastSentBoundsRef.current === nextKey) {
        perfCountersRef.current.syncSkips += 1;
        return;
      }
      lastSentBoundsRef.current = nextKey;
      perfCountersRef.current.syncSends += 1;
      void api.browser
        .setPanelBounds({ threadId, bounds, surface: "renderer" })
        .catch(ignoreBrowserBoundsSyncError);
    };

    // The panel can slide horizontally without resizing. A short burst keeps the
    // native browser view in lockstep without paying for a long frame-by-frame loop.
    const syncBoundsBurst = (frames = BROWSER_BOUNDS_SYNC_BURST_FRAMES) => {
      if (boundsBurstFrameRef.current !== null) {
        perfCountersRef.current.burstExtensions += 1;
        burstFramesRemainingRef.current = Math.max(burstFramesRemainingRef.current, frames);
        burstStableFramesRef.current = 0;
        return;
      }

      perfCountersRef.current.burstStarts += 1;
      burstFramesRemainingRef.current = frames;
      burstStableFramesRef.current = 0;
      const tick = () => {
        perfCountersRef.current.burstFrames += 1;
        const previousMeasuredKey = lastMeasuredBoundsKeyRef.current;
        syncBounds();
        const measuredHidden = lastMeasuredBoundsKeyRef.current?.endsWith(":hidden") ?? false;
        if (!measuredHidden && lastMeasuredBoundsKeyRef.current === previousMeasuredKey) {
          burstStableFramesRef.current += 1;
        } else {
          burstStableFramesRef.current = 0;
        }
        burstFramesRemainingRef.current -= 1;
        if (
          burstFramesRemainingRef.current > 0 &&
          burstStableFramesRef.current < BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET
        ) {
          boundsBurstFrameRef.current = window.requestAnimationFrame(tick);
          return;
        }
        boundsBurstFrameRef.current = null;
        burstFramesRemainingRef.current = 0;
        burstStableFramesRef.current = 0;
      };

      boundsBurstFrameRef.current = window.requestAnimationFrame(tick);
    };

    const scheduleSyncBounds = () => {
      perfCountersRef.current.resizeSchedules += 1;
      if (resizeFrameRef.current !== null) {
        perfCountersRef.current.resizeScheduleSkips += 1;
        return;
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        syncBounds();
      });
    };

    const handleTransitionBounds = (event: TransitionEvent) => {
      if (!isNativeBrowserTransitionSignalTarget(event.target, element)) {
        perfCountersRef.current.ignoredTransitionSignals += 1;
        return;
      }

      if (
        event.propertyName.length > 0 &&
        !VIEWPORT_TRANSITION_PROPERTIES.has(event.propertyName)
      ) {
        perfCountersRef.current.ignoredTransitionSignals += 1;
        return;
      }

      perfCountersRef.current.transitionSignals += 1;
      scheduleSyncBounds();
      if (event.type === "transitionrun") {
        syncBoundsBurst();
      }
    };

    syncBounds();
    syncBoundsBurst();
    const observer = new ResizeObserver(() => {
      scheduleSyncBounds();
    });
    observer.observe(element);
    window.addEventListener("resize", scheduleSyncBounds);
    window.addEventListener(PANEL_RESIZE_OVERLAY_SYNC_EVENT, scheduleSyncBounds);
    document.addEventListener("transitionrun", handleTransitionBounds, true);
    document.addEventListener("transitionend", handleTransitionBounds, true);
    document.addEventListener("transitioncancel", handleTransitionBounds, true);

    return () => {
      setBrowserWebviewOverlayOcclusion(webviewRef.current, false);
      observer.disconnect();
      window.removeEventListener("resize", scheduleSyncBounds);
      window.removeEventListener(PANEL_RESIZE_OVERLAY_SYNC_EVENT, scheduleSyncBounds);
      document.removeEventListener("transitionrun", handleTransitionBounds, true);
      document.removeEventListener("transitionend", handleTransitionBounds, true);
      document.removeEventListener("transitioncancel", handleTransitionBounds, true);
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      if (boundsBurstFrameRef.current !== null) {
        cancelAnimationFrame(boundsBurstFrameRef.current);
        boundsBurstFrameRef.current = null;
      }
      burstFramesRemainingRef.current = 0;
      burstStableFramesRef.current = 0;
    };
  }, [api, isLiveRuntime, showLocalServersHome, threadId]);

  return { viewportRef };
}
