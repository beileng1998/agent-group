import * as Path from "node:path";
import {
  BrowserWindow,
  Menu,
  nativeTheme,
  screen,
  session,
  shell,
  systemPreferences,
  type BrowserWindowConstructorOptions,
  type MenuItemConstructorOptions,
} from "electron";
import { AGENT_GROUP_DESKTOP_ENTRY_URL } from "@agent-group/shared/desktopIdentity";
import { getMacTrafficLightPosition } from "@agent-group/shared/desktopChrome";
import { shouldAllowMediaPermissionRequest } from "../mediaPermissions";
import {
  readDesktopWindowState,
  resolveVisibleWindowBounds,
  writeDesktopWindowState,
} from "../windowState";
import {
  APP_DISPLAY_NAME,
  DESKTOP_WINDOW_STATE_PATH,
  WINDOW_STATE_CHANNEL,
  ZOOM_FACTOR_CHANGED_CHANNEL,
  isDevelopment,
} from "./constants";
import { desktopState } from "./state";
import { browserManager } from "./browserRuntime";
import { resolveIconPath } from "./appIdentity";
import { getSafeExternalUrl, formatErrorMessage } from "./values";
import type { DesktopUpdateRuntime } from "./updateRuntime";

export function getDesktopWindowState(window: BrowserWindow): {
  isMaximized: boolean;
  isFullscreen: boolean;
} {
  return { isMaximized: window.isMaximized(), isFullscreen: window.isFullScreen() };
}

export function emitDesktopWindowState(
  window: BrowserWindow | null = desktopState.mainWindow,
): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(WINDOW_STATE_CHANNEL, getDesktopWindowState(window));
  }
}

function getIconOption(): { icon: string } | Record<string, never> {
  if (process.platform === "darwin") return {};
  const iconPath = resolveIconPath(process.platform === "win32" ? "ico" : "png");
  return iconPath ? { icon: iconPath } : {};
}

function getWindowMaterialOptions(): BrowserWindowConstructorOptions {
  if (process.platform !== "darwin") {
    return { backgroundColor: nativeTheme.shouldUseDarkColors ? "#181818" : "#ffffff" };
  }
  return {
    vibrancy: "under-window",
    visualEffectState: "followWindow",
    backgroundColor: "#00000000",
  };
}

function getTitleBarOptions(): BrowserWindowConstructorOptions {
  if (process.platform === "win32") return { frame: false };
  if (process.platform !== "darwin") return {};
  return { titleBarStyle: "hiddenInset", trafficLightPosition: getMacTrafficLightPosition() };
}

export class DesktopWindowRuntime {
  constructor(private readonly updates: DesktopUpdateRuntime) {}

  createWindow = (): BrowserWindow => {
    const savedWindowState = readDesktopWindowState(DESKTOP_WINDOW_STATE_PATH);
    const primaryDisplay = screen.getPrimaryDisplay();
    const restoredBounds = savedWindowState
      ? resolveVisibleWindowBounds({
          savedBounds: savedWindowState.bounds,
          displayWorkAreas: [
            primaryDisplay.workArea,
            ...screen
              .getAllDisplays()
              .filter((display) => display.id !== primaryDisplay.id)
              .map((display) => display.workArea),
          ],
          minimumWidth: 840,
          minimumHeight: 620,
        })
      : { width: 1100, height: 780 };
    const window = new BrowserWindow({
      ...restoredBounds,
      minWidth: 840,
      minHeight: 620,
      show: false,
      autoHideMenuBar: true,
      ...getIconOption(),
      title: APP_DISPLAY_NAME,
      ...getTitleBarOptions(),
      ...getWindowMaterialOptions(),
      webPreferences: {
        preload: Path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
        backgroundThrottling: true,
      },
    });
    browserManager.setWindow(window);
    const notifyZoom = () => {
      if (!window.webContents.isDestroyed()) {
        window.webContents.send(ZOOM_FACTOR_CHANGED_CHANNEL, window.webContents.getZoomFactor());
      }
    };
    window.webContents.on("zoom-changed", notifyZoom);
    window.webContents.on("did-finish-load", notifyZoom);
    window.webContents.on("context-menu", (event, params) => {
      event.preventDefault();
      const template: MenuItemConstructorOptions[] = [];
      if (params.misspelledWord) {
        for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
          template.push({
            label: suggestion,
            click: () => window.webContents.replaceMisspelling(suggestion),
          });
        }
        if (!params.dictionarySuggestions.length) {
          template.push({ label: "No suggestions", enabled: false });
        }
        template.push({ type: "separator" });
      }
      if (params.mediaType === "image") {
        template.push({
          label: "Copy Image",
          click: () => window.webContents.copyImageAt(params.x, params.y),
        });
        template.push({ type: "separator" });
      }
      template.push(
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { role: "selectAll", enabled: params.editFlags.canSelectAll },
      );
      Menu.buildFromTemplate(template).popup({ window });
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      const externalUrl = getSafeExternalUrl(url);
      if (externalUrl) void shell.openExternal(externalUrl);
      return { action: "deny" };
    });
    window.on("page-title-updated", (event) => {
      event.preventDefault();
      window.setTitle(APP_DISPLAY_NAME);
    });
    window.webContents.on("did-finish-load", () => {
      window.setTitle(APP_DISPLAY_NAME);
      this.updates.emitState();
    });
    window.once("ready-to-show", () => {
      if (!savedWindowState || savedWindowState.isMaximized) window.maximize();
      window.show();
      emitDesktopWindowState(window);
    });
    window.on("maximize", () => emitDesktopWindowState(window));
    window.on("unmaximize", () => emitDesktopWindowState(window));
    window.on("enter-full-screen", () => emitDesktopWindowState(window));
    window.on("leave-full-screen", () => emitDesktopWindowState(window));
    window.on("close", () => {
      try {
        writeDesktopWindowState(DESKTOP_WINDOW_STATE_PATH, {
          version: 1,
          bounds: window.getNormalBounds(),
          isMaximized: window.isMaximized(),
        });
      } catch (error) {
        console.warn(`[desktop] Failed to persist window state: ${formatErrorMessage(error)}`);
      }
    });
    if (isDevelopment) {
      void window.loadURL(process.env.VITE_DEV_SERVER_URL as string);
      window.webContents.openDevTools({ mode: "detach" });
    } else {
      void window.loadURL(AGENT_GROUP_DESKTOP_ENTRY_URL);
    }
    window.on("closed", () => {
      if (desktopState.mainWindow === window) desktopState.mainWindow = null;
      browserManager.setWindow(null);
    });
    return window;
  };

  configureMediaPermissions(): void {
    const defaultSession = session.defaultSession;
    if (!defaultSession) return;
    defaultSession.setPermissionCheckHandler((_webContents, permission) => {
      if (permission !== "media") return false;
      return process.platform === "darwin"
        ? systemPreferences.getMediaAccessStatus("microphone") === "granted"
        : false;
    });
    defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
      if (permission !== "media" || !shouldAllowMediaPermissionRequest(details)) {
        callback(false);
        return;
      }
      if (process.platform === "darwin") {
        if (systemPreferences.getMediaAccessStatus("microphone") === "granted") {
          callback(true);
          return;
        }
        void systemPreferences
          .askForMediaAccess("microphone")
          .then(callback, () => callback(false));
        return;
      }
      callback(true);
    });
  }
}
