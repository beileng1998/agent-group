import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { app } from "electron";
import type { DesktopUpdateState } from "@agent-group/contracts";
import {
  clearInstallMarker,
  readInstallMarker,
  resolveInstallMarkerOutcome,
  writeInstallMarker,
  type UpdateInstallMarker,
} from "../updateInstallMarker";
import {
  resolveElectronUpdaterLegacyZipPath,
  resolveElectronUpdaterPendingCacheDir,
} from "../updatePendingCache";
import { collectMacUpdateDiagnostics } from "../macUpdateDiagnostics";
import { reduceDesktopUpdateStateOnInstallRestartFailure } from "../updateMachine";
import {
  APP_USER_MODEL_ID,
  AUTO_UPDATE_DIAGNOSTICS_TIMEOUT_MS,
  UPDATE_INSTALL_MARKER_FILE_NAME,
} from "./constants";
import type { UpdateContext } from "./updateTypes";
import { formatErrorMessage } from "./values";

export class UpdateStorage {
  constructor(
    private readonly context: UpdateContext,
    private readonly setState: (patch: Partial<DesktopUpdateState>) => void,
  ) {}

  markerPath(): string {
    return Path.join(app.getPath("userData"), UPDATE_INSTALL_MARKER_FILE_NAME);
  }

  recordInstallMarkerFailure(nowIso: string): number {
    const result = readInstallMarker(this.markerPath());
    if (result.status !== "valid") {
      console.error(
        `[desktop-updater] Could not record durable install failure: marker is ${result.status}${result.status === "invalid" ? ` (${result.error})` : ""}.`,
      );
      return Math.max(1, this.context.state.installFailureCount + 1);
    }
    if (result.marker.phase === "failed") return result.marker.consecutiveFailures;
    const failedMarker: UpdateInstallMarker = {
      ...result.marker,
      phase: "failed",
      consecutiveFailures: result.marker.consecutiveFailures + 1,
      lastFailureAt: nowIso,
    };
    try {
      writeInstallMarker(this.markerPath(), failedMarker);
    } catch (error) {
      console.error(
        `[desktop-updater] Failed to persist install failure marker: ${formatErrorMessage(error)}`,
      );
    }
    return failedMarker.consecutiveFailures;
  }

  async logMacUpdateDiagnostics(context: string): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const diagnostics = await Promise.race([
        collectMacUpdateDiagnostics(APP_USER_MODEL_ID),
        new Promise<string>((resolve) => {
          timeout = setTimeout(
            () => resolve("Diagnostic collection timed out."),
            AUTO_UPDATE_DIAGNOSTICS_TIMEOUT_MS,
          );
        }),
      ]);
      if (diagnostics) console.info(`[desktop-updater] diagnostics (${context})\n${diagnostics}`);
    } catch (error) {
      console.info(
        `[desktop-updater] diagnostics (${context}) unavailable: ${formatErrorMessage(error)}`,
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private cachePathArgs() {
    return {
      cacheDirName: this.context.configuredUpdaterCacheDirName,
      platform: process.platform,
      homeDir: OS.homedir(),
      localAppData: process.env.LOCALAPPDATA ?? null,
      xdgCacheHome: process.env.XDG_CACHE_HOME ?? null,
    };
  }

  private clearLegacyUpdaterZipAfterVerifiedInstall(): void {
    const legacyZipPath = resolveElectronUpdaterLegacyZipPath(this.cachePathArgs());
    if (!legacyZipPath) return;
    try {
      FS.rmSync(legacyZipPath, { force: true });
      console.info("[desktop-updater] Cleared legacy top-level update.zip after verified install.");
    } catch (error) {
      console.warn(
        `[desktop-updater] Failed to clear legacy top-level update.zip: ${formatErrorMessage(error)}`,
      );
    }
  }

  private quarantineInstallMarker(reason: string): void {
    console.warn(`[desktop-updater] Discarding update install marker (${reason}).`);
    try {
      clearInstallMarker(this.markerPath());
    } catch (error) {
      console.warn(
        `[desktop-updater] Failed to delete quarantined update install marker: ${formatErrorMessage(error)}`,
      );
    }
  }

  processInstallMarkerOnStartup(): void {
    const readResult = readInstallMarker(this.markerPath());
    if (readResult.status === "missing") return;
    if (readResult.status === "invalid") {
      this.quarantineInstallMarker(`invalid or unreadable: ${readResult.error}`);
      return;
    }
    const marker = readResult.marker;
    const nowIso = new Date().toISOString();
    const outcome = resolveInstallMarkerOutcome(marker, app.getVersion(), nowIso);
    if (outcome === "success") {
      console.info(
        `[desktop-updater] Update to ${marker.toVersion} installed successfully (from ${marker.fromVersion})`,
      );
      try {
        clearInstallMarker(this.markerPath());
      } catch (error) {
        console.warn(
          `[desktop-updater] Failed to clear successful update install marker: ${formatErrorMessage(error)}`,
        );
      }
      this.clearLegacyUpdaterZipAfterVerifiedInstall();
      return;
    }
    if (outcome === "stale" || outcome === "invalid") {
      this.quarantineInstallMarker(outcome);
      return;
    }
    let consecutiveFailures = marker.consecutiveFailures;
    if (outcome === "failure") {
      consecutiveFailures += 1;
      try {
        writeInstallMarker(this.markerPath(), {
          ...marker,
          phase: "failed",
          consecutiveFailures,
          lastFailureAt: nowIso,
        });
      } catch (error) {
        console.error(
          `[desktop-updater] Failed to persist restart install failure: ${formatErrorMessage(error)}`,
        );
      }
    }
    this.context.automaticActivitySuppressed = true;
    const message = `Agent Group restarted, but update ${marker.toVersion} was not installed. Try again.`;
    this.setState(
      reduceDesktopUpdateStateOnInstallRestartFailure(
        this.context.state,
        marker.toVersion,
        consecutiveFailures,
        message,
      ),
    );
    console.error(
      `[desktop-updater] UPDATE INSTALL FAILED: still running ${app.getVersion()} after attempting ${marker.toVersion}; consecutive failures=${consecutiveFailures}. Automatic update checks are suppressed until the user retries.`,
    );
    void this.logMacUpdateDiagnostics("startup install verification failure");
  }

  async clearPendingUpdateCache(reason: string): Promise<void> {
    const pendingDir = resolveElectronUpdaterPendingCacheDir(this.cachePathArgs());
    if (!pendingDir || this.context.downloadInFlight) return;
    try {
      await FS.promises.rm(pendingDir, { recursive: true, force: true });
      console.info(`[desktop-updater] Cleared pending update cache (${reason}).`);
    } catch (error) {
      console.warn(
        `[desktop-updater] Failed to clear pending update cache (${reason}): ${formatErrorMessage(error)}`,
      );
    }
  }

  clearPendingUpdateCacheWhenSafe(reason: string): void {
    this.context.pendingCacheClearQueue.request(
      reason,
      this.context.downloadInFlight,
      (safeReason) => void this.clearPendingUpdateCache(safeReason),
    );
  }
}
