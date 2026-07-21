import { app } from "electron";
import { autoUpdater } from "electron-updater";
import {
  isExpectedStalledDownloadCancellationError,
  isUpdateVersionNewer,
  shouldBroadcastDownloadProgress,
} from "../updateState";
import {
  reduceDesktopUpdateStateOnDownloadComplete,
  reduceDesktopUpdateStateOnDownloadProgress,
  reduceDesktopUpdateStateOnNoUpdate,
  reduceDesktopUpdateStateOnUpdateAvailable,
} from "../updateMachine";
import { isArm64HostRunningIntelBuild } from "../runtimeArch";
import type { DesktopUpdateState } from "@agent-group/contracts";
import type { DownloadProgressSample } from "../updateState";
import type { UpdateStorage } from "./updateStorage";
import type { DesktopRuntimeInfo, UpdateContext, UpdateDependencies } from "./updateTypes";
import { formatErrorMessage } from "./values";

export interface UpdateEventRuntime {
  readonly context: UpdateContext;
  readonly storage: UpdateStorage;
  readonly dependencies: UpdateDependencies;
  readonly runtimeInfo: DesktopRuntimeInfo;
  setState(patch: Partial<DesktopUpdateState>): void;
  schedulePoll(): void;
  clearCheckTimeout(): void;
  clearDownloadStallTimer(): void;
  updateDownloadStallTimerOnProgress(progress: DownloadProgressSample): void;
  resolveErrorContext(): DesktopUpdateState["errorContext"];
  clearInstallInFlightAfterError(): void;
  isStalledCancellationSuppressionArmed(): boolean;
  consumeStalledCancellationSuppression(): void;
  prepareAvailableUpdateInBackground(reason: string): void;
}

export function configureUpdateEvents(runtime: UpdateEventRuntime): void {
  let lastLoggedDownloadMilestone = -1;
  if (isArm64HostRunningIntelBuild(runtime.runtimeInfo)) {
    console.info(
      "[desktop-updater] Apple Silicon host detected while running Intel build; updates will switch to arm64 packages.",
    );
  }
  autoUpdater.on("checking-for-update", () => {
    console.info("[desktop-updater] Looking for updates...");
  });
  autoUpdater.on("update-available", (info) => {
    runtime.clearCheckTimeout();
    if (!isUpdateVersionNewer(app.getVersion(), info.version)) {
      void runtime.storage.clearPendingUpdateCache(
        "available version is not newer than current app",
      );
      runtime.setState(
        reduceDesktopUpdateStateOnNoUpdate(runtime.context.state, new Date().toISOString()),
      );
      lastLoggedDownloadMilestone = -1;
      console.info(
        `[desktop-updater] Ignoring non-newer update ${info.version}; current version is ${app.getVersion()}.`,
      );
      return;
    }
    runtime.setState(
      reduceDesktopUpdateStateOnUpdateAvailable(
        runtime.context.state,
        info.version,
        new Date().toISOString(),
      ),
    );
    lastLoggedDownloadMilestone = -1;
    console.info(`[desktop-updater] Update available: ${info.version}`);
    runtime.prepareAvailableUpdateInBackground(`available ${info.version}`);
  });
  autoUpdater.on("update-not-available", () => {
    runtime.clearCheckTimeout();
    void runtime.storage.clearPendingUpdateCache("no newer update available");
    runtime.setState(
      reduceDesktopUpdateStateOnNoUpdate(runtime.context.state, new Date().toISOString()),
    );
    lastLoggedDownloadMilestone = -1;
    console.info("[desktop-updater] No updates available.");
  });
  autoUpdater.on("error", (error) => {
    runtime.clearCheckTimeout();
    const message = formatErrorMessage(error);
    const errorContext = runtime.resolveErrorContext();
    if (
      isExpectedStalledDownloadCancellationError({
        suppressionArmed: runtime.isStalledCancellationSuppressionArmed(),
        errorContext,
        message,
      })
    ) {
      runtime.consumeStalledCancellationSuppression();
      console.warn("[desktop-updater] Ignored expected cancellation after stalled download.");
      return;
    }
    runtime.clearInstallInFlightAfterError();
    const installFailureCount =
      errorContext === "install"
        ? runtime.storage.recordInstallMarkerFailure(new Date().toISOString())
        : runtime.context.state.installFailureCount;
    if (errorContext === "install") {
      runtime.dependencies.startBackend();
      runtime.schedulePoll();
    }
    if (!runtime.context.checkInFlight && !runtime.context.downloadInFlight) {
      runtime.setState({
        status: "error",
        message,
        checkedAt: new Date().toISOString(),
        downloadPercent: null,
        errorContext,
        canRetry:
          runtime.context.state.availableVersion !== null ||
          runtime.context.state.downloadedVersion !== null,
        installFailureCount,
      });
    }
    console.error(`[desktop-updater] Updater error: ${message}`);
  });
  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.floor(progress.percent);
    runtime.updateDownloadStallTimerOnProgress(progress);
    if (
      shouldBroadcastDownloadProgress(runtime.context.state, progress.percent) ||
      runtime.context.state.message !== null
    ) {
      runtime.setState(
        reduceDesktopUpdateStateOnDownloadProgress(runtime.context.state, progress.percent),
      );
    }
    const milestone = percent - (percent % 10);
    if (milestone > lastLoggedDownloadMilestone) {
      lastLoggedDownloadMilestone = milestone;
      console.info(`[desktop-updater] Download progress: ${percent}%`);
    }
  });
  autoUpdater.on("update-downloaded", (info) => {
    runtime.clearDownloadStallTimer();
    if (!isUpdateVersionNewer(app.getVersion(), info.version)) {
      runtime.storage.clearPendingUpdateCacheWhenSafe(
        "downloaded version is not newer than current app",
      );
      runtime.setState(
        reduceDesktopUpdateStateOnNoUpdate(runtime.context.state, new Date().toISOString()),
      );
      console.info(
        `[desktop-updater] Ignoring downloaded non-newer update ${info.version}; current version is ${app.getVersion()}.`,
      );
      return;
    }
    runtime.setState(
      reduceDesktopUpdateStateOnDownloadComplete(runtime.context.state, info.version),
    );
    console.info(`[desktop-updater] Update downloaded: ${info.version}`);
  });
}
