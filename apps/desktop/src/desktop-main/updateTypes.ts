import type { DesktopUpdateState } from "@agent-group/contracts";
import type { CancellationToken } from "electron-updater";
import type { DownloadProgressSample } from "../updateState";
import type { PendingUpdateCacheClearQueue } from "../updatePendingCache";
import type { resolveDesktopRuntimeInfo } from "../runtimeArch";

export interface UpdateContext {
  pollTimer: ReturnType<typeof setInterval> | null;
  startupTimer: ReturnType<typeof setTimeout> | null;
  checkInFlight: boolean;
  downloadInFlight: boolean;
  configured: boolean;
  state: DesktopUpdateState;
  backgroundedAtMs: number | null;
  backgroundBlurTimer: ReturnType<typeof setTimeout> | null;
  checkTimeoutTimer: ReturnType<typeof setTimeout> | null;
  downloadStallTimer: ReturnType<typeof setTimeout> | null;
  installWatchdogTimer: ReturnType<typeof setTimeout> | null;
  automaticActivitySuppressed: boolean;
  downloadCancellationToken: CancellationToken | null;
  rejectDownloadStall: ((error: Error) => void) | null;
  lastDownloadProgressSample: DownloadProgressSample | null;
  stalledCancellationSuppressionsRemaining: number;
  stalledCancellationSuppressionExpiresAtMs: number;
  installPreparing: boolean;
  quitAndInstallInFlight: boolean;
  configuredGitHubUpdateSource: ReturnType<
    typeof import("../githubUpdateFeed").resolveGitHubUpdateSource
  >;
  configuredUpdaterCacheDirName: string | null;
  pendingCacheClearQueue: PendingUpdateCacheClearQueue;
}

export interface UpdateDependencies {
  startBackend(): void;
  stopBackendAndWaitForExit(): Promise<void>;
}

export type DesktopRuntimeInfo = ReturnType<typeof resolveDesktopRuntimeInfo>;
