import { app, BrowserWindow, dialog, session } from "electron";
import { detectTailnetProxyUrl } from "../tailnetProxy";
import { isBackendReadinessAborted } from "../backendReadiness";
import { isBrokenPipeError } from "../desktopProcessErrors";
import {
  ensureInitialBackendWindowOpen,
  initializeBackendAuthToken,
  reserveBackendEndpoint,
  setTailnetProxyUrl,
  startBackend,
  stopBackend,
  stopBackendAndWaitForExit,
  waitForBackendWindowReady,
} from "./backendRuntime";
import { disposeBrowserUsePipeServer, browserManager } from "./browserRuntime";
import { initializeDesktopAppSnap } from "./appSnapRuntime";
import { registerIpcHandlers } from "./ipcRuntime";
import { registerDesktopProtocol } from "./staticProtocol";
import { desktopState, backendState } from "./state";
import { writeDesktopLogHeader } from "./logging";
import { formatErrorMessage } from "./values";
import { focusMainWindow } from "./notifications";
import { isDevelopment } from "./constants";
import type { DesktopWindowRuntime } from "./windowRuntime";
import type { DesktopUpdateRuntime } from "./updateRuntime";
import type { DesktopMenuRuntime } from "./menuRuntime";
import type { BundleSwapRuntime } from "./bundleSwap";
import { BundleChangedDuringStartupError } from "./bundleValues";
import {
  applyLegacyMacDockIcon,
  configureAppIdentity,
  refreshMacIconCacheOnVersionChange,
} from "./appIdentity";

export class DesktopAppLifecycle {
  constructor(
    private readonly hasSingleInstanceLock: boolean,
    private readonly windows: DesktopWindowRuntime,
    private readonly updates: DesktopUpdateRuntime,
    private readonly menu: DesktopMenuRuntime,
    private readonly bundleSwap: BundleSwapRuntime,
  ) {}

  private async shutdownDesktopRuntime(reason: string): Promise<void> {
    if (desktopState.desktopShutdownPromise) return desktopState.desktopShutdownPromise;
    desktopState.isQuitting = true;
    desktopState.desktopShutdownPromise = (async () => {
      writeDesktopLogHeader(`${reason} shutdown start`);
      try {
        this.updates.clearBackgroundBlurTimer();
        this.updates.clearCheckTimeout();
        this.updates.clearPollTimer();
        desktopState.appSnapManager?.dispose();
        desktopState.appSnapManager = null;
        await disposeBrowserUsePipeServer(reason);
        await stopBackendAndWaitForExit();
        browserManager.dispose();
        desktopState.restoreStdIoCapture?.();
        writeDesktopLogHeader(`${reason} shutdown complete`);
      } finally {
        desktopState.desktopShutdownComplete = true;
      }
    })();
    return desktopState.desktopShutdownPromise;
  }

  requestGracefulAppQuit = (reason: string): void => {
    if (this.updates.context.installPreparing) {
      writeDesktopLogHeader(`${reason} waiting for updater quit-and-install`);
      return;
    }
    void this.shutdownDesktopRuntime(reason)
      .catch((error: unknown) => {
        const message = formatErrorMessage(error);
        writeDesktopLogHeader(`${reason} shutdown failed message=${message}`);
        console.warn(`[desktop] Shutdown failed during ${reason}: ${message}`);
      })
      .finally(() => app.quit());
  };

  private handleFatalStartupError(stage: string, error: unknown): void {
    const message = formatErrorMessage(error);
    const detail =
      error instanceof Error && typeof error.stack === "string" ? `\n${error.stack}` : "";
    writeDesktopLogHeader(`fatal startup error stage=${stage} message=${message}`);
    console.error(`[desktop] fatal startup error (${stage})`, error);
    if (!desktopState.isQuitting) {
      desktopState.isQuitting = true;
      dialog.showErrorBox("Agent Group failed to start", `Stage: ${stage}\n${message}${detail}`);
    }
    stopBackend();
    desktopState.restoreStdIoCapture?.();
    app.quit();
  }

  private async bootstrap(): Promise<void> {
    writeDesktopLogHeader("bootstrap start");
    initializeBackendAuthToken();
    await reserveBackendEndpoint("bootstrap");
    try {
      const url = await detectTailnetProxyUrl((target) =>
        session.defaultSession.resolveProxy(target),
      );
      setTailnetProxyUrl(url);
      writeDesktopLogHeader(`tailnet network path=${url ? "system-proxy" : "direct"}`);
    } catch (error) {
      setTailnetProxyUrl(undefined);
      writeDesktopLogHeader(
        `tailnet proxy resolution unavailable message=${formatErrorMessage(error)}`,
      );
    }
    registerIpcHandlers(this.updates);
    writeDesktopLogHeader("bootstrap ipc handlers registered");
    startBackend();
    writeDesktopLogHeader("bootstrap backend start requested");
    if (isDevelopment) {
      void waitForBackendWindowReady(backendState.httpUrl)
        .then((source) => {
          writeDesktopLogHeader(`bootstrap backend ready source=${source}`);
          if (!desktopState.mainWindow) {
            desktopState.mainWindow = this.windows.createWindow();
            writeDesktopLogHeader("bootstrap main window created");
          }
        })
        .catch((error) => {
          if (isBackendReadinessAborted(error)) return;
          writeDesktopLogHeader(
            `bootstrap backend readiness warning message=${formatErrorMessage(error)}`,
          );
          console.warn("[desktop] backend readiness check timed out during dev bootstrap", error);
          if (!desktopState.mainWindow) {
            desktopState.mainWindow = this.windows.createWindow();
            writeDesktopLogHeader("bootstrap main window created after readiness warning");
          }
        });
      return;
    }
    ensureInitialBackendWindowOpen();
  }

  register(): void {
    app.on("before-quit", (event) => {
      writeDesktopLogHeader("before-quit received");
      if (desktopState.desktopShutdownComplete) return;
      if (this.updates.context.quitAndInstallInFlight) {
        try {
          this.updates.markInstallHandoff();
        } catch (error) {
          console.error(
            `[desktop-updater] Failed to persist install handoff marker during quit: ${formatErrorMessage(error)}`,
          );
        }
        writeDesktopLogHeader("before-quit allowing updater quit-and-install");
        return;
      }
      if (this.updates.context.installPreparing) {
        writeDesktopLogHeader("before-quit waiting for updater quit-and-install");
        event.preventDefault();
        return;
      }
      event.preventDefault();
      this.requestGracefulAppQuit("before-quit");
    });

    if (this.hasSingleInstanceLock) {
      app
        .whenReady()
        .then(() => {
          writeDesktopLogHeader("app ready");
          configureAppIdentity();
          applyLegacyMacDockIcon();
          refreshMacIconCacheOnVersionChange();
          this.windows.configureMediaPermissions();
          initializeDesktopAppSnap(this.windows.createWindow);
          this.menu.configure();
          try {
            registerDesktopProtocol();
          } catch (error) {
            if (error instanceof BundleChangedDuringStartupError) {
              this.bundleSwap.restartAfterStartupBundleSwap(error);
              return;
            }
            throw error;
          }
          this.bundleSwap.startWatcher();
          this.updates.configure();
          void this.bootstrap().catch((error) => this.handleFatalStartupError("bootstrap", error));
          app.on("browser-window-blur", () => this.updates.markBackgrounded());
          app.on("browser-window-focus", () => this.updates.handleForegrounded());
          app.on("activate", () => {
            this.updates.handleForegrounded();
            if (BrowserWindow.getAllWindows().length === 0) {
              if (!isDevelopment) {
                ensureInitialBackendWindowOpen();
                return;
              }
              void waitForBackendWindowReady(backendState.httpUrl)
                .catch((error) => {
                  if (!isBackendReadinessAborted(error)) {
                    console.warn(
                      "[desktop] backend readiness check timed out during dev activate",
                      error,
                    );
                  }
                })
                .finally(() => {
                  if (!desktopState.mainWindow)
                    desktopState.mainWindow = this.windows.createWindow();
                });
              return;
            }
            focusMainWindow();
          });
        })
        .catch((error) => this.handleFatalStartupError("whenReady", error));
    }

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });
    if (process.platform !== "win32") {
      process.on("uncaughtException", (error: unknown) => {
        if (!isBrokenPipeError(error)) throw error;
        if (desktopState.desktopShutdownPromise) return;
        writeDesktopLogHeader("EPIPE received");
        this.requestGracefulAppQuit("EPIPE");
      });
      process.on("SIGINT", () => {
        if (desktopState.desktopShutdownPromise) return;
        writeDesktopLogHeader("SIGINT received");
        this.requestGracefulAppQuit("SIGINT");
      });
      process.on("SIGTERM", () => {
        if (desktopState.desktopShutdownPromise) return;
        writeDesktopLogHeader("SIGTERM received");
        this.requestGracefulAppQuit("SIGTERM");
      });
    }
  }
}
