// FILE: browser-manager/oauthPopups.ts
// Purpose: Own OAuth and sign-in popup windows opened by browser tabs.
// Layer: Desktop browser runtime

import { BrowserWindow, shell } from "electron";
import type { BrowserPanelBounds, ThreadId } from "@agent-group/contracts";
import {
  BROWSER_BLANK_URL as ABOUT_BLANK_URL,
  classifyBrowserWindowOpen,
} from "@agent-group/shared/browserSession";

import {
  BROWSER_SESSION_PARTITION,
  type OAuthPopupContext,
  type OAuthPopupRuntime,
} from "./contracts";
import type { BrowserSessionIdentity } from "./sessionIdentity";

interface BrowserPopupCallbacks {
  getParentWindow(): BrowserWindow | null;
  openNewTab(threadId: ThreadId, url: string): void;
  getVisibleBoundsForThread(threadId: ThreadId): BrowserPanelBounds | null;
  isActiveThread(threadId: ThreadId): boolean;
  attachActiveTab(threadId: ThreadId, bounds: BrowserPanelBounds): void;
}

export class BrowserOAuthPopupController {
  private readonly popupRuntimes = new Map<BrowserWindow, OAuthPopupRuntime>();

  constructor(
    private readonly identity: BrowserSessionIdentity,
    private readonly callbacks: BrowserPopupCallbacks,
  ) {}

  buildWindowOptions(): Electron.BrowserWindowConstructorOptions {
    const options: Electron.BrowserWindowConstructorOptions = {
      width: 480,
      height: 640,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      skipTaskbar: true,
      title: "Sign in",
      webPreferences: {
        partition: BROWSER_SESSION_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    };
    const parent = this.callbacks.getParentWindow();
    if (parent) options.parent = parent;
    return options;
  }

  register(popup: BrowserWindow, context: OAuthPopupContext): void {
    if (this.popupRuntimes.has(popup)) return;
    const runtime: OAuthPopupRuntime = { ...context, window: popup, listenerDisposers: [] };
    this.popupRuntimes.set(popup, runtime);
    popup.setMenuBarVisibility(false);
    this.configure(runtime);
    this.center(runtime);
  }

  private configure(runtime: OAuthPopupRuntime): void {
    const { window: popup } = runtime;
    const { webContents } = popup;
    webContents.setUserAgent(this.identity.resolveSpoofedUserAgent());

    const closeOnInput = (event: Electron.Event, input: Electron.Input) => {
      if (input.type !== "keyDown") return;
      const key = input.key.toLowerCase();
      const isCloseChord =
        key === "escape" ||
        (key === "w" && !input.shift && !input.alt && (input.meta || input.control));
      if (!isCloseChord) return;
      event.preventDefault();
      this.closeRuntime(runtime);
    };
    webContents.on("before-input-event", closeOnInput);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("before-input-event", closeOnInput);
    });

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
        return { action: "allow", overrideBrowserWindowOptions: this.buildWindowOptions() };
      }

      this.callbacks.openNewTab(runtime.threadId, url);
      const bounds = this.callbacks.getVisibleBoundsForThread(runtime.threadId);
      if (this.callbacks.isActiveThread(runtime.threadId) && bounds) {
        this.callbacks.attachActiveTab(runtime.threadId, bounds);
      }
      return { action: "deny" };
    });

    const nestedWindowHandler = (nested: BrowserWindow) => {
      this.register(nested, { threadId: runtime.threadId, tabId: runtime.tabId });
    };
    webContents.on("did-create-window", nestedWindowHandler);
    runtime.listenerDisposers.push(() => {
      webContents.removeListener("did-create-window", nestedWindowHandler);
    });

    popup.once("closed", () => {
      this.remove(runtime);
    });
  }

  private remove(runtime: OAuthPopupRuntime): void {
    if (this.popupRuntimes.get(runtime.window) !== runtime) return;
    for (const dispose of runtime.listenerDisposers.splice(0)) dispose();
    this.popupRuntimes.delete(runtime.window);
  }

  private closeRuntime(runtime: OAuthPopupRuntime): void {
    this.remove(runtime);
    if (!runtime.window.isDestroyed()) runtime.window.destroy();
  }

  private center(runtime: OAuthPopupRuntime): void {
    const parent = this.callbacks.getParentWindow();
    const popup = runtime.window;
    if (!parent || parent.isDestroyed() || popup.isDestroyed()) return;
    const parentBounds = parent.getBounds();
    const popupBounds = popup.getBounds();
    const nextBounds = {
      x: Math.round(parentBounds.x + (parentBounds.width - popupBounds.width) / 2),
      y: Math.round(parentBounds.y + (parentBounds.height - popupBounds.height) / 2),
      width: popupBounds.width,
      height: popupBounds.height,
    };
    if (
      popupBounds.x === nextBounds.x &&
      popupBounds.y === nextBounds.y &&
      popupBounds.width === nextBounds.width &&
      popupBounds.height === nextBounds.height
    ) {
      return;
    }
    popup.setBounds(nextBounds);
  }

  updateForThread(threadId: ThreadId): void {
    for (const runtime of this.popupRuntimes.values()) {
      if (runtime.threadId === threadId) this.center(runtime);
    }
  }

  private closeWhere(shouldClose: (runtime: OAuthPopupRuntime) => boolean): void {
    for (const runtime of [...this.popupRuntimes.values()]) {
      if (shouldClose(runtime)) this.closeRuntime(runtime);
    }
  }

  closeForThread(threadId: ThreadId): void {
    this.closeWhere((runtime) => runtime.threadId === threadId);
  }

  closeForTab(threadId: ThreadId, tabId: string): void {
    this.closeWhere((runtime) => runtime.threadId === threadId && runtime.tabId === tabId);
  }

  closeAll(): void {
    this.closeWhere(() => true);
  }
}
