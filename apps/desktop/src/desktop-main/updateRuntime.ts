import { app, BrowserWindow } from "electron";
import type { DesktopUpdateState } from "@agent-group/contracts";
import { autoUpdater, CancellationToken } from "electron-updater";
import {
  getAutoUpdateDisabledReason,
  getDownloadStallTimeoutMessage,
  hasDownloadProgressAdvanced,
  isUpdateVersionNewer,
  shouldCheckForUpdatesOnForeground,
  type DownloadProgressSample,
} from "../updateState";
import {
  createUpdateInstallMarker,
  markInstallHandoffSync,
  readInstallMarker,
  writeInstallMarker,
} from "../updateInstallMarker";
import { PendingUpdateCacheClearQueue } from "../updatePendingCache";
import {
  createInitialDesktopUpdateState,
  reduceDesktopUpdateStateOnCheckFailure,
  reduceDesktopUpdateStateOnCheckStart,
  reduceDesktopUpdateStateOnDownloadFailure,
  reduceDesktopUpdateStateOnDownloadStart,
  reduceDesktopUpdateStateOnInstallFailure,
  reduceDesktopUpdateStateOnNoUpdate,
} from "../updateMachine";
import {
  AUTO_UPDATE_CHECK_TIMEOUT_MS,
  AUTO_UPDATE_DOWNLOAD_SETTLE_TIMEOUT_MS,
  AUTO_UPDATE_DOWNLOAD_STALL_TIMEOUT_MS,
  AUTO_UPDATE_FOREGROUND_RECHECK_MIN_BACKGROUND_MS,
  AUTO_UPDATE_FOREGROUND_RECHECK_MIN_INTERVAL_MS,
  AUTO_UPDATE_INSTALL_WATCHDOG_MS,
  AUTO_UPDATE_POLL_INTERVAL_MS,
  AUTO_UPDATE_STALLED_DOWNLOAD_CANCELLATION_SUPPRESSION_MS,
  UPDATE_STATE_CHANNEL,
  isDevelopment,
} from "./constants";
import { desktopState } from "./state";
import type { DesktopRuntimeInfo, UpdateContext, UpdateDependencies } from "./updateTypes";
import { UpdateStorage } from "./updateStorage";
import { configureDesktopUpdateRuntime } from "./updateConfiguration";
import { readAppUpdateYml } from "./appIdentity";
import { clearUnreadNotificationBadge } from "./notifications";
import { formatErrorMessage } from "./values";

type DesktopUpdateErrorContext = DesktopUpdateState["errorContext"];

export class DesktopUpdateRuntime {
  readonly context: UpdateContext;
  readonly storage: UpdateStorage;

  constructor(
    readonly dependencies: UpdateDependencies,
    readonly runtimeInfo: DesktopRuntimeInfo,
  ) {
    this.context = {
      pollTimer: null,
      startupTimer: null,
      checkInFlight: false,
      downloadInFlight: false,
      configured: false,
      state: createInitialDesktopUpdateState(app.getVersion(), runtimeInfo),
      backgroundedAtMs: null,
      backgroundBlurTimer: null,
      checkTimeoutTimer: null,
      downloadStallTimer: null,
      installWatchdogTimer: null,
      automaticActivitySuppressed: false,
      downloadCancellationToken: null,
      rejectDownloadStall: null,
      lastDownloadProgressSample: null,
      stalledCancellationSuppressionsRemaining: 0,
      stalledCancellationSuppressionExpiresAtMs: 0,
      installPreparing: false,
      quitAndInstallInFlight: false,
      configuredGitHubUpdateSource: null,
      configuredUpdaterCacheDirName: null,
      pendingCacheClearQueue: new PendingUpdateCacheClearQueue(),
    };
    this.storage = new UpdateStorage(this.context, (patch) => this.setState(patch));
  }

  get state(): DesktopUpdateState {
    return this.context.state;
  }

  get isInstalling(): boolean {
    return this.context.installPreparing || this.context.quitAndInstallInFlight;
  }

  emitState(): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(UPDATE_STATE_CHANNEL, this.context.state);
    }
  }

  setState(patch: Partial<DesktopUpdateState>): void {
    this.context.state = { ...this.context.state, ...patch };
    this.emitState();
  }

  resolveDisabledReason(): string | null {
    return getAutoUpdateDisabledReason({
      isDevelopment,
      isPackaged: app.isPackaged,
      platform: process.platform,
      appImage: process.env.APPIMAGE,
      disabledByEnv: process.env.AGENT_GROUP_DISABLE_AUTO_UPDATE === "1",
      hasUpdateFeedConfig:
        readAppUpdateYml() !== null || Boolean(process.env.AGENT_GROUP_DESKTOP_MOCK_UPDATES),
    });
  }

  clearPollTimer(): void {
    if (this.context.startupTimer) clearTimeout(this.context.startupTimer);
    if (this.context.pollTimer) clearInterval(this.context.pollTimer);
    this.context.startupTimer = null;
    this.context.pollTimer = null;
  }

  schedulePoll(): void {
    if (this.context.pollTimer || this.context.automaticActivitySuppressed) return;
    this.context.pollTimer = setInterval(
      () => void this.checkForUpdates("poll"),
      AUTO_UPDATE_POLL_INTERVAL_MS,
    );
    this.context.pollTimer.unref();
  }

  clearBackgroundBlurTimer(): void {
    if (this.context.backgroundBlurTimer) clearTimeout(this.context.backgroundBlurTimer);
    this.context.backgroundBlurTimer = null;
  }

  clearCheckTimeout(): void {
    if (this.context.checkTimeoutTimer) clearTimeout(this.context.checkTimeoutTimer);
    this.context.checkTimeoutTimer = null;
  }

  private armCheckTimeout(reason: string): void {
    this.clearCheckTimeout();
    this.context.checkTimeoutTimer = setTimeout(() => {
      this.context.checkTimeoutTimer = null;
      if (this.context.state.status !== "checking") return;
      this.context.checkInFlight = false;
      this.setState(
        reduceDesktopUpdateStateOnCheckFailure(
          this.context.state,
          "Timed out while checking for updates. Try again.",
          new Date().toISOString(),
        ),
      );
      console.error(`[desktop-updater] Update check timed out (${reason}).`);
    }, AUTO_UPDATE_CHECK_TIMEOUT_MS);
    this.context.checkTimeoutTimer.unref();
  }

  clearDownloadStallTimer(): void {
    if (this.context.downloadStallTimer) clearTimeout(this.context.downloadStallTimer);
    this.context.downloadStallTimer = null;
  }

  armDownloadStallTimer(reason: string): void {
    this.clearDownloadStallTimer();
    this.context.downloadStallTimer = setTimeout(() => {
      this.context.downloadStallTimer = null;
      if (!this.context.downloadInFlight || this.context.state.status !== "downloading") return;
      const error = new Error(
        getDownloadStallTimeoutMessage(AUTO_UPDATE_DOWNLOAD_STALL_TIMEOUT_MS),
      );
      console.error(`[desktop-updater] ${error.message} (${reason}).`);
      this.context.stalledCancellationSuppressionsRemaining += 1;
      this.context.stalledCancellationSuppressionExpiresAtMs =
        Date.now() + AUTO_UPDATE_STALLED_DOWNLOAD_CANCELLATION_SUPPRESSION_MS;
      this.context.rejectDownloadStall?.(error);
      this.context.downloadCancellationToken?.cancel();
    }, AUTO_UPDATE_DOWNLOAD_STALL_TIMEOUT_MS);
    this.context.downloadStallTimer.unref();
  }

  updateDownloadStallTimerOnProgress(progress: DownloadProgressSample): void {
    if (
      !this.context.downloadInFlight ||
      !hasDownloadProgressAdvanced(this.context.lastDownloadProgressSample, progress)
    )
      return;
    this.context.lastDownloadProgressSample = {
      percent: progress.percent ?? null,
      transferred: progress.transferred ?? null,
    };
    this.armDownloadStallTimer(`download progress ${Math.floor(progress.percent ?? 0)}%`);
  }

  resolveErrorContext(): DesktopUpdateErrorContext {
    if (this.context.installPreparing || this.context.quitAndInstallInFlight) return "install";
    if (this.context.downloadInFlight) return "download";
    if (this.context.checkInFlight) return "check";
    return this.context.state.errorContext;
  }

  clearInstallInFlightAfterError(): void {
    if (!this.context.installPreparing && !this.context.quitAndInstallInFlight) return;
    this.context.installPreparing = false;
    this.context.quitAndInstallInFlight = false;
    desktopState.isQuitting = false;
  }

  isStalledCancellationSuppressionArmed(): boolean {
    if (this.context.stalledCancellationSuppressionsRemaining <= 0) return false;
    if (Date.now() <= this.context.stalledCancellationSuppressionExpiresAtMs) return true;
    this.context.stalledCancellationSuppressionsRemaining = 0;
    this.context.stalledCancellationSuppressionExpiresAtMs = 0;
    return false;
  }

  consumeStalledCancellationSuppression(): void {
    this.context.stalledCancellationSuppressionsRemaining = Math.max(
      0,
      this.context.stalledCancellationSuppressionsRemaining - 1,
    );
    if (!this.context.stalledCancellationSuppressionsRemaining) {
      this.context.stalledCancellationSuppressionExpiresAtMs = 0;
    }
  }

  markBackgrounded(): void {
    this.clearBackgroundBlurTimer();
    this.context.backgroundBlurTimer = setTimeout(() => {
      this.context.backgroundBlurTimer = null;
      const focused = BrowserWindow.getAllWindows().some(
        (window) => !window.isDestroyed() && window.isFocused(),
      );
      if (!focused) this.context.backgroundedAtMs = Date.now();
    }, 0);
  }

  handleForegrounded(): void {
    this.clearBackgroundBlurTimer();
    clearUnreadNotificationBadge();
    const foregroundedAtMs = Date.now();
    const shouldCheck = shouldCheckForUpdatesOnForeground({
      checkedAt: this.context.state.checkedAt,
      backgroundedAtMs: this.context.backgroundedAtMs,
      foregroundedAtMs,
      minBackgroundDurationMs: AUTO_UPDATE_FOREGROUND_RECHECK_MIN_BACKGROUND_MS,
      minIntervalMs: AUTO_UPDATE_FOREGROUND_RECHECK_MIN_INTERVAL_MS,
    });
    this.context.backgroundedAtMs = null;
    if (shouldCheck) void this.checkForUpdates("foreground");
  }

  async checkForUpdates(reason: string): Promise<void> {
    if (desktopState.isQuitting || !this.context.configured || this.context.checkInFlight) return;
    if (this.context.automaticActivitySuppressed) {
      if (reason !== "menu" && reason !== "renderer") {
        console.info(
          `[desktop-updater] Skipping automatic update check (${reason}) after an unverified install failure.`,
        );
        return;
      }
      this.context.automaticActivitySuppressed = false;
      console.info(
        `[desktop-updater] User requested update recovery (${reason}); automatic checks are enabled for this session.`,
      );
      this.schedulePoll();
    }
    if (["checking", "downloading", "downloaded"].includes(this.context.state.status)) {
      console.info(
        `[desktop-updater] Skipping update check (${reason}) while status=${this.context.state.status}.`,
      );
      return;
    }
    this.context.checkInFlight = true;
    this.setState(
      reduceDesktopUpdateStateOnCheckStart(this.context.state, new Date().toISOString()),
    );
    this.armCheckTimeout(reason);
    console.info(`[desktop-updater] Checking for updates (${reason})...`);
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.clearCheckTimeout();
      const message = formatErrorMessage(error);
      this.setState(
        reduceDesktopUpdateStateOnCheckFailure(
          this.context.state,
          message,
          new Date().toISOString(),
        ),
      );
      console.error(`[desktop-updater] Failed to check for updates: ${message}`);
    } finally {
      this.context.checkInFlight = false;
    }
  }

  async downloadAvailableUpdate(): Promise<{ accepted: boolean; completed: boolean }> {
    if (
      this.context.configured &&
      this.context.state.status === "error" &&
      this.context.state.errorContext === "install" &&
      this.context.state.downloadedVersion === null &&
      this.context.state.availableVersion !== null
    ) {
      await this.checkForUpdates("renderer");
      return { accepted: true, completed: false };
    }
    if (
      !this.context.configured ||
      this.context.downloadInFlight ||
      this.context.state.status !== "available"
    ) {
      return { accepted: false, completed: false };
    }
    if (!this.isKnownVersionNewer(this.context.state.availableVersion)) {
      await this.storage.clearPendingUpdateCache("available version is not newer than current app");
      this.setState(
        reduceDesktopUpdateStateOnNoUpdate(this.context.state, new Date().toISOString()),
      );
      console.info(
        `[desktop-updater] Ignoring stale available update ${this.context.state.availableVersion ?? "unknown"} for current ${app.getVersion()}.`,
      );
      return { accepted: false, completed: false };
    }
    this.context.downloadInFlight = true;
    this.setState(reduceDesktopUpdateStateOnDownloadStart(this.context.state));
    this.context.lastDownloadProgressSample = null;
    const cancellationToken = new CancellationToken();
    this.context.downloadCancellationToken = cancellationToken;
    const stalled = new Promise<never>((_, reject) => {
      this.context.rejectDownloadStall = reject;
    });
    this.armDownloadStallTimer("download start");
    console.info("[desktop-updater] Downloading update...");
    let settled = false;
    const download = autoUpdater.downloadUpdate(cancellationToken);
    const observed = download.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    try {
      await Promise.race([download, stalled]);
      return { accepted: true, completed: true };
    } catch (error) {
      const message = formatErrorMessage(error);
      this.setState(reduceDesktopUpdateStateOnDownloadFailure(this.context.state, message));
      console.error(`[desktop-updater] Failed to download update: ${message}`);
      return { accepted: true, completed: false };
    } finally {
      this.clearDownloadStallTimer();
      if (!settled) {
        await Promise.race([
          observed,
          new Promise<void>((resolve) =>
            setTimeout(resolve, AUTO_UPDATE_DOWNLOAD_SETTLE_TIMEOUT_MS).unref(),
          ),
        ]);
      }
      if (this.context.downloadCancellationToken === cancellationToken) {
        this.context.downloadCancellationToken = null;
      }
      this.context.rejectDownloadStall = null;
      this.context.lastDownloadProgressSample = null;
      this.context.downloadInFlight = false;
      const reason = this.context.pendingCacheClearQueue.consumeAfterDownload();
      if (reason) await this.storage.clearPendingUpdateCache(reason);
    }
  }

  prepareAvailableUpdateInBackground(reason: string): void {
    if (this.context.downloadInFlight || this.context.state.status !== "available") return;
    void this.downloadAvailableUpdate()
      .then((result) => {
        if (result.accepted && result.completed) {
          console.info(`[desktop-updater] Background update download completed (${reason}).`);
        }
      })
      .catch((error) => {
        console.error(
          `[desktop-updater] Background update download crashed (${reason}): ${formatErrorMessage(error)}`,
        );
      });
  }

  async installDownloadedUpdate(): Promise<{ accepted: boolean; completed: boolean }> {
    if (
      desktopState.isQuitting ||
      !this.context.configured ||
      this.context.state.status !== "downloaded"
    ) {
      return { accepted: false, completed: false };
    }
    const version = this.context.state.downloadedVersion ?? this.context.state.availableVersion;
    if (!version || !this.isKnownVersionNewer(version)) {
      await this.storage.clearPendingUpdateCache(
        "downloaded version is not newer than current app",
      );
      this.setState(
        reduceDesktopUpdateStateOnNoUpdate(this.context.state, new Date().toISOString()),
      );
      console.info(
        `[desktop-updater] Ignoring stale downloaded update ${version ?? "unknown"} for current ${app.getVersion()}.`,
      );
      return { accepted: false, completed: false };
    }
    const existing = readInstallMarker(this.storage.markerPath());
    const previous =
      existing.status === "valid" && existing.marker.toVersion === version ? existing.marker : null;
    const marker = createUpdateInstallMarker({
      fromVersion: app.getVersion(),
      toVersion: version,
      requestedAt: new Date().toISOString(),
      consecutiveFailures: previous?.consecutiveFailures ?? 0,
      lastFailureAt: previous?.lastFailureAt ?? null,
    });
    let markerWritten = false;
    try {
      writeInstallMarker(this.storage.markerPath(), marker);
      markerWritten = true;
      desktopState.isQuitting = true;
      this.context.installPreparing = true;
      this.clearPollTimer();
      await this.dependencies.stopBackendAndWaitForExit();
      await this.storage.logMacUpdateDiagnostics("before install handoff");
      this.context.quitAndInstallInFlight = true;
      autoUpdater.quitAndInstall();
      this.armInstallWatchdog();
      return { accepted: true, completed: false };
    } catch (error) {
      const message = formatErrorMessage(error);
      this.context.installPreparing = false;
      this.context.quitAndInstallInFlight = false;
      desktopState.isQuitting = false;
      const failures = markerWritten
        ? this.storage.recordInstallMarkerFailure(new Date().toISOString())
        : this.context.state.installFailureCount;
      this.dependencies.startBackend();
      this.schedulePoll();
      this.setState({
        ...reduceDesktopUpdateStateOnInstallFailure(this.context.state, message),
        installFailureCount: failures,
      });
      console.error(`[desktop-updater] Failed to install update: ${message}`);
      return { accepted: true, completed: false };
    }
  }

  private armInstallWatchdog(): void {
    if (this.context.installWatchdogTimer) clearTimeout(this.context.installWatchdogTimer);
    this.context.installWatchdogTimer = setTimeout(() => {
      this.context.installWatchdogTimer = null;
      if (!this.context.quitAndInstallInFlight) return;
      this.clearInstallInFlightAfterError();
      this.dependencies.startBackend();
      this.schedulePoll();
      const failures = this.storage.recordInstallMarkerFailure(new Date().toISOString());
      this.setState({
        ...reduceDesktopUpdateStateOnInstallFailure(
          this.context.state,
          "The update couldn’t be installed automatically.",
        ),
        installFailureCount: failures,
      });
      console.error(
        "[desktop-updater] quitAndInstall did not exit the app within the watchdog window; surfacing manual-download fallback.",
      );
    }, AUTO_UPDATE_INSTALL_WATCHDOG_MS);
  }

  isKnownVersionNewer(version: string | null | undefined): boolean {
    return typeof version === "string" && isUpdateVersionNewer(app.getVersion(), version);
  }

  markInstallHandoff(): void {
    markInstallHandoffSync(this.storage.markerPath());
  }

  configure(): void {
    configureDesktopUpdateRuntime(this);
  }
}
