import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  type MenuItemConstructorOptions,
} from "electron";
import {
  resolveDesktopMenuAccelerator,
  resolveKeyboardShortcutsMenuAccelerator,
  shouldUseNativeZoomMenuRoles,
} from "../menuShortcuts";
import {
  DESKTOP_MENU_MAX_ZOOM_FACTOR,
  DESKTOP_MENU_MIN_ZOOM_FACTOR,
  DESKTOP_MENU_ZOOM_FACTOR_STEP,
  MENU_ACTION_CHANNEL,
} from "./constants";
import { desktopState } from "./state";
import type { DesktopWindowRuntime } from "./windowRuntime";
import type { DesktopUpdateRuntime } from "./updateRuntime";

let destructiveMenuIconCache: Electron.NativeImage | null | undefined;

export function getDestructiveMenuIcon(): Electron.NativeImage | undefined {
  if (process.platform !== "darwin") return undefined;
  if (destructiveMenuIconCache !== undefined) return destructiveMenuIconCache ?? undefined;
  try {
    const icon = nativeImage.createFromNamedImage("trash").resize({ width: 14, height: 14 });
    if (icon.isEmpty()) {
      destructiveMenuIconCache = null;
      return undefined;
    }
    icon.setTemplateImage(true);
    destructiveMenuIconCache = icon;
    return icon;
  } catch {
    destructiveMenuIconCache = null;
    return undefined;
  }
}

export class DesktopMenuRuntime {
  constructor(
    private readonly windows: DesktopWindowRuntime,
    private readonly updates: DesktopUpdateRuntime,
  ) {}

  dispatchAction(action: string): void {
    const existing =
      BrowserWindow.getFocusedWindow() ??
      desktopState.mainWindow ??
      BrowserWindow.getAllWindows()[0];
    const target = existing ?? this.windows.createWindow();
    if (!existing) desktopState.mainWindow = target;
    const send = () => {
      if (target.isDestroyed()) return;
      target.webContents.send(MENU_ACTION_CHANNEL, action);
      if (!target.isVisible()) target.show();
      target.focus();
    };
    if (target.webContents.isLoadingMainFrame()) {
      target.webContents.once("did-finish-load", send);
    } else {
      send();
    }
  }

  private targetWindow(): BrowserWindow | null {
    return (
      BrowserWindow.getFocusedWindow() ??
      desktopState.mainWindow ??
      BrowserWindow.getAllWindows()[0] ??
      null
    );
  }

  private adjustZoom(multiplier: number): void {
    const webContents = this.targetWindow()?.webContents;
    if (!webContents) return;
    webContents.setZoomFactor(
      Math.min(
        DESKTOP_MENU_MAX_ZOOM_FACTOR,
        Math.max(DESKTOP_MENU_MIN_ZOOM_FACTOR, webContents.getZoomFactor() * multiplier),
      ),
    );
  }

  private handleCheckForUpdates(): void {
    const disabledReason = this.updates.resolveDisabledReason();
    if (disabledReason) {
      console.info("[desktop-updater] Manual update check requested, but updates are disabled.");
      void dialog.showMessageBox({
        type: "info",
        title: "Updates unavailable",
        message: "Automatic updates are not available right now.",
        detail: disabledReason,
        buttons: ["OK"],
      });
      return;
    }
    if (!BrowserWindow.getAllWindows().length) {
      desktopState.mainWindow = this.windows.createWindow();
    }
    void this.checkForUpdatesFromMenu();
  }

  private async checkForUpdatesFromMenu(): Promise<void> {
    await this.updates.checkForUpdates("menu");
    const state = this.updates.state;
    if (state.status === "up-to-date") {
      void dialog.showMessageBox({
        type: "info",
        title: "You're up to date!",
        message: `Agent Group ${state.currentVersion} is currently the newest version available.`,
        buttons: ["OK"],
      });
    } else if (state.status === "downloading" || state.status === "available") {
      void dialog.showMessageBox({
        type: "info",
        title: "Update found",
        message: "Agent Group is preparing the update in the background.",
        buttons: ["OK"],
      });
    } else if (state.status === "downloaded") {
      void dialog.showMessageBox({
        type: "info",
        title: "Update ready",
        message: "Click Update in the sidebar when you’re ready to restart and install it.",
        buttons: ["OK"],
      });
    } else if (state.status === "error") {
      void dialog.showMessageBox({
        type: "warning",
        title: "Update check failed",
        message: "Could not check for updates.",
        detail: state.message ?? "An unknown error occurred. Please try again later.",
        buttons: ["OK"],
      });
    }
  }

  configure(): void {
    const template: MenuItemConstructorOptions[] = [];
    const shortcutsAccelerator = resolveKeyboardShortcutsMenuAccelerator(process.platform);
    const acceleratorProps = (
      accelerator: MenuItemConstructorOptions["accelerator"],
    ): Pick<MenuItemConstructorOptions, "accelerator"> => {
      const resolved = resolveDesktopMenuAccelerator(process.platform, accelerator);
      return resolved ? { accelerator: resolved } : {};
    };
    const zoomItems: MenuItemConstructorOptions[] = shouldUseNativeZoomMenuRoles(process.platform)
      ? [
          { role: "resetZoom" },
          { role: "zoomIn", ...acceleratorProps("CmdOrCtrl+=") },
          { role: "zoomIn", ...acceleratorProps("CmdOrCtrl+Plus"), visible: false },
          { role: "zoomOut" },
        ]
      : [
          { label: "Reset Zoom", click: () => this.targetWindow()?.webContents.setZoomFactor(1) },
          { label: "Zoom In", click: () => this.adjustZoom(DESKTOP_MENU_ZOOM_FACTOR_STEP) },
          { label: "Zoom Out", click: () => this.adjustZoom(1 / DESKTOP_MENU_ZOOM_FACTOR_STEP) },
        ];
    if (process.platform === "darwin") {
      template.push({
        label: app.name,
        submenu: [
          { role: "about" },
          { label: "Check for Updates...", click: () => this.handleCheckForUpdates() },
          { type: "separator" },
          {
            label: "Settings...",
            accelerator: "CmdOrCtrl+,",
            click: () => this.dispatchAction("open-settings"),
          },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      });
    }
    template.push(
      {
        label: "File",
        submenu: [
          ...(process.platform === "darwin"
            ? []
            : [
                {
                  label: "Settings...",
                  ...acceleratorProps("CmdOrCtrl+,"),
                  click: () => this.dispatchAction("open-settings"),
                },
                { type: "separator" as const },
              ]),
          { role: process.platform === "darwin" ? "close" : "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          {
            label: "New Terminal Tab",
            ...acceleratorProps("CmdOrCtrl+T"),
            click: () => this.dispatchAction("new-terminal-tab"),
          },
          { type: "separator" },
          {
            label: "Toggle Sidebar",
            ...acceleratorProps("CmdOrCtrl+B"),
            click: () => this.dispatchAction("toggle-sidebar"),
          },
          {
            label: "Toggle Browser",
            ...acceleratorProps("CmdOrCtrl+Shift+B"),
            click: () => this.dispatchAction("toggle-browser"),
          },
          { type: "separator" },
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          ...zoomItems,
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          {
            label: "Keyboard Shortcuts",
            ...(shortcutsAccelerator ? { accelerator: shortcutsAccelerator } : {}),
            click: () => this.dispatchAction("show-shortcuts"),
          },
          { type: "separator" },
          { label: "Check for Updates...", click: () => this.handleCheckForUpdates() },
        ],
      },
    );
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
}
