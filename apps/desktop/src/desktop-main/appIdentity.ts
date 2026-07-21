import * as ChildProcess from "node:child_process";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { app, nativeImage } from "electron";

import {
  LSREGISTER_PATH,
  parseLastLaunchVersion,
  resolveLaunchVersionRecordPath,
  resolveMacAppBundlePath,
  serializeLaunchVersionRecord,
  shouldRefreshIconCache,
} from "../macIconCacheRefresh";
import {
  repairBrowserProfileFromBridgeManifest,
  resolveDesktopAppDataBase,
  resolveDesktopUserDataPath,
} from "../desktopUserDataProfile";
import {
  APP_DISPLAY_NAME,
  APP_USER_MODEL_ID,
  COMMIT_HASH_DISPLAY_LENGTH,
  COMMIT_HASH_PATTERN,
  ROOT_DIR,
  isDevelopment,
} from "./constants";
import { desktopState } from "./state";

export function resolveAppRoot(): string {
  return app.isPackaged ? app.getAppPath() : ROOT_DIR;
}

export function readAppUpdateYml(): Record<string, string> | null {
  if (desktopState.appUpdateYmlCache !== undefined) return desktopState.appUpdateYmlCache;
  try {
    const ymlPath = app.isPackaged
      ? Path.join(process.resourcesPath, "app-update.yml")
      : Path.join(app.getAppPath(), "dev-app-update.yml");
    const raw = FS.readFileSync(ymlPath, "utf-8");
    const entries: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match?.[1] && match[2]) entries[match[1]] = match[2].trim();
    }
    desktopState.appUpdateYmlCache = entries.provider ? entries : null;
  } catch {
    desktopState.appUpdateYmlCache = null;
  }
  return desktopState.appUpdateYmlCache;
}

function normalizeCommitHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return COMMIT_HASH_PATTERN.test(trimmed)
    ? trimmed.slice(0, COMMIT_HASH_DISPLAY_LENGTH).toLowerCase()
    : null;
}

export function resolveAboutCommitHash(): string | null {
  if (desktopState.aboutCommitHashCache !== undefined) return desktopState.aboutCommitHashCache;
  const envCommitHash = normalizeCommitHash(process.env.AGENT_GROUP_COMMIT_HASH);
  if (envCommitHash) {
    desktopState.aboutCommitHashCache = envCommitHash;
    return envCommitHash;
  }
  if (!app.isPackaged) {
    desktopState.aboutCommitHashCache = null;
    return null;
  }
  try {
    const parsed = JSON.parse(
      FS.readFileSync(Path.join(resolveAppRoot(), "package.json"), "utf8"),
    ) as { agentGroupCommitHash?: unknown };
    desktopState.aboutCommitHashCache = normalizeCommitHash(parsed.agentGroupCommitHash);
  } catch {
    desktopState.aboutCommitHashCache = null;
  }
  return desktopState.aboutCommitHashCache;
}

export function resolveResourcePath(fileName: string): string | null {
  const candidates = [
    Path.join(__dirname, "../resources", fileName),
    Path.join(__dirname, "../prod-resources", fileName),
    Path.join(process.resourcesPath, "resources", fileName),
    Path.join(process.resourcesPath, fileName),
  ];
  return candidates.find((candidate) => FS.existsSync(candidate)) ?? null;
}

export function resolveIconPath(ext: "ico" | "icns" | "png"): string | null {
  return resolveResourcePath(`icon.${ext}`);
}

export function resolveNotificationIconPath(): string | null {
  if (process.platform === "darwin") return null;
  if (process.platform === "win32") {
    return resolveResourcePath("agent-group.png") ?? resolveIconPath("ico");
  }
  return resolveResourcePath("agent-group.png") ?? resolveIconPath("png");
}

export function resolveUserDataPath(): string {
  return resolveDesktopUserDataPath({
    appDataBase: resolveDesktopAppDataBase(),
    isDevelopment,
  });
}

export function repairBrowserProfileBeforeElectronReady(userDataPath: string): void {
  const result = repairBrowserProfileFromBridgeManifest(userDataPath);
  if (result.status === "repaired") {
    console.info("[desktop] Completed Agent Group browser profile bridge repair", {
      sourcePath: result.sourcePath,
      targetPath: result.targetPath,
      copiedEntries: result.copiedEntries,
    });
  } else if (result.status === "repair-failed") {
    console.warn("[desktop] Failed to complete Agent Group browser profile bridge repair", {
      sourcePath: result.sourcePath,
      targetPath: result.targetPath,
      error: result.error,
    });
  }
}

export function configureAppIdentity(): void {
  app.setName(APP_DISPLAY_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion(),
    version: resolveAboutCommitHash() ?? "unknown",
    copyright: `© ${new Date().getFullYear()} Agent Group contributors`,
  });
  if (process.platform === "win32") app.setAppUserModelId(APP_USER_MODEL_ID);
}

export function applyLegacyMacDockIcon(): void {
  if (process.platform !== "darwin" || !app.dock) return;
  const darwinMajor = Number.parseInt(OS.release().split(".")[0] ?? "", 10);
  if (!Number.isFinite(darwinMajor) || darwinMajor >= 25) return;
  const iconPath = resolveResourcePath("dock-icon.png");
  if (!iconPath) return;
  const image = nativeImage.createFromPath(iconPath);
  if (!image.isEmpty()) app.dock.setIcon(image);
}

function readLaunchVersionRecordContents(): string | null {
  try {
    return FS.readFileSync(resolveLaunchVersionRecordPath(app.getPath("userData")), "utf8");
  } catch {
    return null;
  }
}

function persistLastLaunchVersion(version: string): void {
  const recordPath = resolveLaunchVersionRecordPath(app.getPath("userData"));
  try {
    FS.mkdirSync(Path.dirname(recordPath), { recursive: true });
    FS.writeFileSync(recordPath, serializeLaunchVersionRecord(version));
  } catch (error) {
    console.warn("[desktop] Failed to persist last launch version", error);
  }
}

export function refreshMacIconCacheOnVersionChange(): void {
  if (process.platform !== "darwin" || !app.isPackaged) return;
  const currentVersion = app.getVersion();
  const previousVersion = parseLastLaunchVersion(readLaunchVersionRecordContents());
  if (!shouldRefreshIconCache(previousVersion, currentVersion)) return;
  persistLastLaunchVersion(currentVersion);
  const bundlePath = resolveMacAppBundlePath(process.execPath, process.platform);
  if (!bundlePath || !FS.existsSync(LSREGISTER_PATH)) return;
  try {
    const now = new Date();
    FS.utimesSync(bundlePath, now, now);
  } catch {}
  const child = ChildProcess.spawn(LSREGISTER_PATH, ["-f", bundlePath], { stdio: "ignore" });
  child.unref();
  child.once("error", (error) => {
    console.warn("[desktop] Failed to refresh macOS icon cache after update", error);
  });
  child.once("exit", (code) => {
    console.info(
      `[desktop] Refreshed macOS icon registration after update ${previousVersion ?? "(none)"} -> ${currentVersion} (lsregister exit ${code ?? "unknown"}).`,
    );
  });
}
