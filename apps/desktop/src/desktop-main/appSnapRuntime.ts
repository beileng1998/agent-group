import * as Path from "node:path";
import { app, type BrowserWindow } from "electron";
import { DesktopAppSnapManager } from "../appSnapManager";
import { sendAppSnapCaptured, sendAppSnapError, sendAppSnapState } from "../appSnapIpc";
import { APP_USER_MODEL_ID } from "./constants";
import { desktopState, backendState } from "./state";
import { focusMainWindow, showDesktopNotification } from "./notifications";

function resolveAppSnapHelperPath(): string {
  return app.isPackaged
    ? Path.resolve(process.resourcesPath, "..", "Helpers", "agent-group-appsnap-helper")
    : Path.resolve(__dirname, "..", ".electron-runtime", "appsnap", "agent-group-appsnap-helper");
}

function canSend(window: BrowserWindow | null): window is BrowserWindow {
  return Boolean(
    window &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed() &&
    !window.webContents.isLoadingMainFrame(),
  );
}

function send(
  window: BrowserWindow | null,
  callback: (webContents: BrowserWindow["webContents"]) => void,
): boolean {
  if (!canSend(window)) return false;
  callback(window.webContents);
  return true;
}

export function initializeDesktopAppSnap(createWindow: () => BrowserWindow): void {
  if (desktopState.appSnapManager) return;
  const ensureMainWindow = (): BrowserWindow | null => {
    if (desktopState.mainWindow?.isDestroyed()) desktopState.mainWindow = null;
    if (!desktopState.mainWindow && backendState.port > 0 && !desktopState.isQuitting) {
      desktopState.mainWindow = createWindow();
    }
    if (!desktopState.mainWindow || desktopState.mainWindow.isDestroyed()) return null;
    focusMainWindow({ stealAppFocus: true });
    return desktopState.mainWindow;
  };
  desktopState.appSnapManager = new DesktopAppSnapManager({
    platform: process.platform,
    helperPath: resolveAppSnapHelperPath(),
    captureDirectory: Path.join(app.getPath("userData"), "appsnap", "tmp"),
    excludedBundleId: APP_USER_MODEL_ID,
    onState: (state) => {
      send(desktopState.mainWindow, (webContents) => sendAppSnapState(webContents, state));
    },
    onCaptured: (capture) => {
      const window = ensureMainWindow();
      if (send(window, (webContents) => sendAppSnapCaptured(webContents, capture))) return;
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.once("did-finish-load", () => {
          send(window, (webContents) => sendAppSnapCaptured(webContents, capture));
        });
      }
    },
    onError: (error, focusApp) => {
      const window = focusApp ? ensureMainWindow() : desktopState.mainWindow;
      if (!send(window, (webContents) => sendAppSnapError(webContents, error))) {
        showDesktopNotification({
          title: error.code === "pending-capture-overflow" ? "AppSnap discarded" : "AppSnap failed",
          body: error.message,
        });
      }
    },
  });
}
