import * as FS from "node:fs";
import * as Path from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  shell,
  type IpcMainEvent,
  type MenuItemConstructorOptions,
  type OpenDialogOptions,
} from "electron";
import type { ContextMenuItem, DesktopUpdateActionResult } from "@agent-group/contracts";
import { registerBrowserIpcHandlers } from "../browserIpc";
import {
  DESKTOP_WS_URL_CHANNEL,
  normalizeDesktopWsUrl,
  resolveDesktopWsUrlFromEnv,
} from "../desktopWsBridge";
import {
  acknowledgeAgentGroupStorageSnapshot,
  readAgentGroupStorageSnapshot,
  resolveAgentGroupStorageSnapshotPath,
  STORAGE_MIGRATION_IPC_CHANNELS,
} from "../desktopStorageMigration";
import { registerAppSnapIpcHandlers } from "../appSnapIpc";
import { registerDesktopVoiceTranscriptionHandler } from "../voiceTranscription";
import { showDesktopConfirmDialog } from "../confirmDialog";
import {
  AUTH_REQUEST_CHANNEL,
  CLIPBOARD_WRITE_IMAGE_CHANNEL,
  CONFIRM_CHANNEL,
  CONTEXT_MENU_CHANNEL,
  MAX_CLIPBOARD_IMAGE_DATA_URL_LENGTH,
  NOTIFICATIONS_IS_SUPPORTED_CHANNEL,
  NOTIFICATIONS_SHOW_CHANNEL,
  OPEN_EXTERNAL_CHANNEL,
  PICK_FOLDER_CHANNEL,
  SAVE_FILE_CHANNEL,
  SET_THEME_CHANNEL,
  SHOW_IN_FOLDER_CHANNEL,
  UPDATE_CHECK_CHANNEL,
  UPDATE_DOWNLOAD_CHANNEL,
  UPDATE_GET_STATE_CHANNEL,
  UPDATE_INSTALL_CHANNEL,
  WINDOW_CLOSE_CHANNEL,
  WINDOW_GET_STATE_CHANNEL,
  WINDOW_MINIMIZE_CHANNEL,
  WINDOW_STATE_CHANNEL,
  WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
  ZOOM_FACTOR_CHANNEL,
} from "./constants";
import { backendState, desktopState } from "./state";
import { requestDesktopAuthJson } from "./backendRuntime";
import {
  browserManager,
  ensureBrowserUsePipeServer,
  startBrowserPerformanceLogging,
} from "./browserRuntime";
import { getSafeExternalUrl, getSafeTheme, isSaveFileInput } from "./values";
import { getDestructiveMenuIcon } from "./menuRuntime";
import { getDesktopWindowState } from "./windowRuntime";
import { showDesktopNotification } from "./notifications";
import type { DesktopUpdateRuntime } from "./updateRuntime";

export function registerIpcHandlers(updates: DesktopUpdateRuntime): void {
  const snapshotPath = resolveAgentGroupStorageSnapshotPath(app.getPath("userData"));
  ipcMain.removeAllListeners(STORAGE_MIGRATION_IPC_CHANNELS.read);
  ipcMain.on(STORAGE_MIGRATION_IPC_CHANNELS.read, (event: IpcMainEvent) => {
    event.returnValue = readAgentGroupStorageSnapshot(snapshotPath);
  });
  ipcMain.removeHandler(STORAGE_MIGRATION_IPC_CHANNELS.acknowledge);
  ipcMain.handle(STORAGE_MIGRATION_IPC_CHANNELS.acknowledge, async () => {
    await acknowledgeAgentGroupStorageSnapshot(snapshotPath);
  });
  ipcMain.removeAllListeners(DESKTOP_WS_URL_CHANNEL);
  ipcMain.on(DESKTOP_WS_URL_CHANNEL, (event: IpcMainEvent) => {
    event.returnValue =
      normalizeDesktopWsUrl(backendState.wsUrl) ?? resolveDesktopWsUrlFromEnv(process.env);
  });
  ipcMain.removeHandler(AUTH_REQUEST_CHANNEL);
  ipcMain.handle(AUTH_REQUEST_CHANNEL, (_event, input: unknown) => requestDesktopAuthJson(input));
  ipcMain.removeAllListeners(ZOOM_FACTOR_CHANNEL);
  ipcMain.on(ZOOM_FACTOR_CHANNEL, (event: IpcMainEvent) => {
    event.returnValue = event.sender.getZoomFactor();
  });
  ipcMain.removeHandler(PICK_FOLDER_CHANNEL);
  ipcMain.handle(PICK_FOLDER_CHANNEL, async () => {
    const owner = BrowserWindow.getFocusedWindow() ?? desktopState.mainWindow;
    const options: OpenDialogOptions = { properties: ["openDirectory", "createDirectory"] };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.removeHandler(SAVE_FILE_CHANNEL);
  ipcMain.handle(SAVE_FILE_CHANNEL, async (_event, input: unknown) => {
    if (!isSaveFileInput(input)) throw new Error("Invalid save file input.");
    const owner = BrowserWindow.getFocusedWindow() ?? desktopState.mainWindow;
    const options = {
      defaultPath: input.defaultFilename,
      ...(input.filters ? { filters: input.filters } : {}),
    };
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    await FS.promises.writeFile(result.filePath, input.contents, "utf8");
    return result.filePath;
  });
  ipcMain.removeHandler(CONFIRM_CHANNEL);
  ipcMain.handle(CONFIRM_CHANNEL, async (_event, message: unknown) => {
    if (typeof message !== "string") return false;
    return showDesktopConfirmDialog(
      message,
      BrowserWindow.getFocusedWindow() ?? desktopState.mainWindow,
    );
  });
  ipcMain.removeHandler(SET_THEME_CHANNEL);
  ipcMain.handle(SET_THEME_CHANNEL, async (_event, rawTheme: unknown) => {
    const theme = getSafeTheme(rawTheme);
    if (theme) nativeTheme.themeSource = theme;
  });
  ipcMain.removeHandler(CONTEXT_MENU_CHANNEL);
  ipcMain.handle(
    CONTEXT_MENU_CHANNEL,
    async (_event, items: ContextMenuItem[], position?: { x: number; y: number }) => {
      const normalized = items
        .filter((item) => typeof item.id === "string" && typeof item.label === "string")
        .map((item) => ({
          id: item.id,
          label: item.label,
          separatorBefore: item.separatorBefore === true,
          destructive: item.destructive === true,
        }));
      if (!normalized.length) return null;
      const popupPosition =
        position &&
        Number.isFinite(position.x) &&
        Number.isFinite(position.y) &&
        position.x >= 0 &&
        position.y >= 0
          ? { x: Math.floor(position.x), y: Math.floor(position.y) }
          : null;
      const window = BrowserWindow.getFocusedWindow() ?? desktopState.mainWindow;
      if (!window) return null;
      return new Promise<string | null>((resolve) => {
        const template: MenuItemConstructorOptions[] = [];
        let insertedDestructiveSeparator = false;
        for (const item of normalized) {
          if (
            (item.separatorBefore ||
              (item.destructive && !insertedDestructiveSeparator && template.length > 0)) &&
            template.length > 0
          ) {
            template.push({ type: "separator" });
          }
          if (item.destructive) insertedDestructiveSeparator = true;
          const option: MenuItemConstructorOptions = {
            label: item.label,
            click: () => resolve(item.id),
          };
          if (item.destructive) {
            const icon = getDestructiveMenuIcon();
            if (icon) option.icon = icon;
          }
          template.push(option);
        }
        Menu.buildFromTemplate(template).popup({
          window,
          ...popupPosition,
          callback: () => resolve(null),
        });
      });
    },
  );
  ipcMain.removeHandler(OPEN_EXTERNAL_CHANNEL);
  ipcMain.handle(OPEN_EXTERNAL_CHANNEL, async (_event, rawUrl: unknown) => {
    const url = getSafeExternalUrl(rawUrl);
    if (!url) return false;
    try {
      await shell.openExternal(url);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.removeHandler(CLIPBOARD_WRITE_IMAGE_CHANNEL);
  ipcMain.handle(CLIPBOARD_WRITE_IMAGE_CHANNEL, async (_event, rawDataUrl: unknown) => {
    if (typeof rawDataUrl !== "string" || rawDataUrl.length > MAX_CLIPBOARD_IMAGE_DATA_URL_LENGTH) {
      return false;
    }
    const dataUrl = rawDataUrl.trim();
    if (!dataUrl.startsWith("data:image/png;base64,")) return false;
    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) return false;
    clipboard.writeImage(image);
    return true;
  });
  ipcMain.removeHandler(SHOW_IN_FOLDER_CHANNEL);
  ipcMain.handle(SHOW_IN_FOLDER_CHANNEL, async (_event, rawPath: unknown) => {
    if (typeof rawPath !== "string" || !rawPath.trim()) throw new Error("Missing folder path.");
    const resolvedPath = Path.resolve(rawPath);
    let stats: FS.Stats;
    try {
      stats = await FS.promises.stat(resolvedPath);
    } catch {
      throw new Error(`Folder not found: ${resolvedPath}`);
    }
    if (stats.isDirectory()) {
      const errorMessage = await shell.openPath(resolvedPath);
      if (errorMessage.trim()) throw new Error(errorMessage);
    } else {
      shell.showItemInFolder(resolvedPath);
    }
  });
  ipcMain.removeHandler(WINDOW_MINIMIZE_CHANNEL);
  ipcMain.handle(WINDOW_MINIMIZE_CHANNEL, async (event) => {
    (BrowserWindow.fromWebContents(event.sender) ?? desktopState.mainWindow)?.minimize();
  });
  ipcMain.removeHandler(WINDOW_TOGGLE_MAXIMIZE_CHANNEL);
  ipcMain.handle(WINDOW_TOGGLE_MAXIMIZE_CHANNEL, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? desktopState.mainWindow;
    if (!window) return { isMaximized: false, isFullscreen: false };
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    const state = getDesktopWindowState(window);
    window.webContents.send(WINDOW_STATE_CHANNEL, state);
    return state;
  });
  ipcMain.removeHandler(WINDOW_CLOSE_CHANNEL);
  ipcMain.handle(WINDOW_CLOSE_CHANNEL, async (event) => {
    (BrowserWindow.fromWebContents(event.sender) ?? desktopState.mainWindow)?.close();
  });
  ipcMain.removeHandler(WINDOW_GET_STATE_CHANNEL);
  ipcMain.handle(WINDOW_GET_STATE_CHANNEL, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? desktopState.mainWindow;
    return window ? getDesktopWindowState(window) : { isMaximized: false, isFullscreen: false };
  });
  ipcMain.removeHandler(UPDATE_GET_STATE_CHANNEL);
  ipcMain.handle(UPDATE_GET_STATE_CHANNEL, async () => updates.state);
  ipcMain.removeHandler(UPDATE_CHECK_CHANNEL);
  ipcMain.handle(UPDATE_CHECK_CHANNEL, async () => {
    await updates.checkForUpdates("renderer");
    return updates.state;
  });
  ipcMain.removeHandler(UPDATE_DOWNLOAD_CHANNEL);
  ipcMain.handle(UPDATE_DOWNLOAD_CHANNEL, async () => {
    const result = await updates.downloadAvailableUpdate();
    return { ...result, state: updates.state } satisfies DesktopUpdateActionResult;
  });
  ipcMain.removeHandler(UPDATE_INSTALL_CHANNEL);
  ipcMain.handle(UPDATE_INSTALL_CHANNEL, async () => {
    if (desktopState.isQuitting) {
      return {
        accepted: false,
        completed: false,
        state: updates.state,
      } satisfies DesktopUpdateActionResult;
    }
    const result = await updates.installDownloadedUpdate();
    return { ...result, state: updates.state } satisfies DesktopUpdateActionResult;
  });
  ipcMain.removeHandler(NOTIFICATIONS_IS_SUPPORTED_CHANNEL);
  ipcMain.handle(NOTIFICATIONS_IS_SUPPORTED_CHANNEL, async () => Notification.isSupported());
  ipcMain.removeHandler(NOTIFICATIONS_SHOW_CHANNEL);
  ipcMain.handle(
    NOTIFICATIONS_SHOW_CHANNEL,
    async (
      _event,
      input:
        | { title?: unknown; body?: unknown; silent?: unknown; threadId?: unknown }
        | null
        | undefined,
    ) =>
      showDesktopNotification({
        title: typeof input?.title === "string" ? input.title : "",
        body: typeof input?.body === "string" ? input.body : "",
        silent: input?.silent === true,
        ...(typeof input?.threadId === "string" ? { threadId: input.threadId } : {}),
      }),
  );
  if (desktopState.appSnapManager) registerAppSnapIpcHandlers(ipcMain, desktopState.appSnapManager);
  registerDesktopVoiceTranscriptionHandler();
  startBrowserPerformanceLogging();
  void ensureBrowserUsePipeServer().catch((error) => {
    console.warn("[Agent Group browser] Failed to start browser-use native pipe", error);
  });
  registerBrowserIpcHandlers(ipcMain, browserManager);
}
