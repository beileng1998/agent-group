import { app } from "electron";
import type { DesktopUpdateState } from "@agent-group/contracts";
import { AGENT_GROUP_DESKTOP_UPDATE_CHANNEL } from "@agent-group/shared/desktopIdentity";
import { autoUpdater, BaseUpdater } from "electron-updater";
import { hardenElectronUpdater } from "../electronUpdaterSecurity";
import { buildGitHubReleasesPageUrl, resolveGitHubUpdateSource } from "../githubUpdateFeed";
import {
  installResumableUpdateDownloader,
  type ResumableDownloaderTarget,
} from "../resumableUpdateDownload";
import { isArm64HostRunningIntelBuild } from "../runtimeArch";
import { createInitialDesktopUpdateState } from "../updateMachine";
import { resolveElectronUpdaterCacheDirName } from "../updatePendingCache";
import { readAppUpdateYml } from "./appIdentity";
import { AUTO_UPDATE_STARTUP_DELAY_MS, DESKTOP_UPDATE_ALLOW_PRERELEASE } from "./constants";
import { configureUpdateEvents, type UpdateEventRuntime } from "./updateEvents";

interface UpdateConfigurationRuntime extends UpdateEventRuntime {
  setState(patch: Partial<DesktopUpdateState>): void;
  resolveDisabledReason(): string | null;
  clearPollTimer(): void;
  checkForUpdates(reason: string): Promise<void>;
  schedulePoll(): void;
}

export function configureDesktopUpdateRuntime(runtime: UpdateConfigurationRuntime): void {
  const config = readAppUpdateYml();
  runtime.context.configuredUpdaterCacheDirName = resolveElectronUpdaterCacheDirName(
    config,
    app.getName(),
  );
  const enabled = runtime.resolveDisabledReason() === null;
  runtime.setState({
    ...createInitialDesktopUpdateState(app.getVersion(), runtime.runtimeInfo),
    enabled,
    status: enabled ? "idle" : "disabled",
  });
  runtime.storage.processInstallMarkerOnStartup();
  if (!enabled) {
    runtime.context.configuredGitHubUpdateSource = null;
    runtime.context.configuredUpdaterCacheDirName = null;
    return;
  }
  runtime.context.configured = true;
  hardenElectronUpdater({ BaseUpdater }, autoUpdater);
  runtime.context.configuredGitHubUpdateSource = resolveGitHubUpdateSource(config);
  if (runtime.context.configuredGitHubUpdateSource) {
    runtime.setState({
      releaseUrl: buildGitHubReleasesPageUrl(runtime.context.configuredGitHubUpdateSource),
    });
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.channel = AGENT_GROUP_DESKTOP_UPDATE_CHANNEL;
  autoUpdater.allowPrerelease = DESKTOP_UPDATE_ALLOW_PRERELEASE;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableDifferentialDownload =
    process.platform === "darwin" || isArm64HostRunningIntelBuild(runtime.runtimeInfo);
  if (!installResumableUpdateDownloader(autoUpdater as unknown as ResumableDownloaderTarget)) {
    console.warn(
      "[desktop-updater] Could not install resumable update downloader; falling back to default transfer.",
    );
  }
  configureUpdateEvents(runtime);
  runtime.clearPollTimer();
  if (runtime.context.automaticActivitySuppressed) {
    console.info(
      "[desktop-updater] Startup and periodic update checks suppressed after failed install verification.",
    );
    return;
  }
  runtime.context.startupTimer = setTimeout(() => {
    runtime.context.startupTimer = null;
    void runtime.checkForUpdates("startup");
  }, AUTO_UPDATE_STARTUP_DELAY_MS);
  runtime.context.startupTimer.unref();
  runtime.schedulePoll();
}
