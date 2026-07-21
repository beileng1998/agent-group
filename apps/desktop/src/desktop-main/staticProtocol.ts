import * as FS from "node:fs";
import * as Path from "node:path";
import { app, protocol } from "electron";
import { ensureStaticSnapshot, findAsarArchivePath } from "@agent-group/shared/staticSnapshot";

import { DESKTOP_SCHEME, isDevelopment } from "./constants";
import { desktopState } from "./state";
import { resolveAppRoot } from "./appIdentity";
import {
  BundleChangedDuringStartupError,
  readBundleSignature,
  type BundleIdentity,
} from "./bundleValues";
import { isBundleStable } from "../bundleSwapDetection";
import { writeDesktopLogHeader } from "./logging";
import { formatErrorMessage } from "./values";

export interface ServedStaticRoot {
  readonly dir: string;
  readonly snapshotted: boolean;
}

let servedStaticRootCache: ServedStaticRoot | null | undefined;
let startupBundleIdentity: BundleIdentity | null = null;

export function setStartupBundleIdentity(identity: BundleIdentity | null): void {
  startupBundleIdentity = identity;
}

export function registerDesktopSchemePrivilege(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: DESKTOP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

function resolveDesktopStaticDir(): string | null {
  const appRoot = resolveAppRoot();
  return (
    [Path.join(appRoot, "apps/server/dist/client"), Path.join(appRoot, "apps/web/dist")].find(
      (candidate) => FS.existsSync(Path.join(candidate, "index.html")),
    ) ?? null
  );
}

function computeServedStaticRoot(): ServedStaticRoot | null {
  const sourceDir = resolveDesktopStaticDir();
  if (!sourceDir) return null;
  const archivePath = findAsarArchivePath(sourceDir);
  if (!archivePath) return { dir: sourceDir, snapshotted: false };
  const startupArchiveSignature =
    startupBundleIdentity && Path.resolve(startupBundleIdentity.path) === Path.resolve(archivePath)
      ? startupBundleIdentity.signature
      : undefined;
  if (startupArchiveSignature === null) {
    throw new BundleChangedDuringStartupError({
      bundlePath: archivePath,
      baseline: null,
      current: readBundleSignature(archivePath),
    });
  }
  const archiveSignature = startupArchiveSignature ?? readBundleSignature(archivePath);
  if (!archiveSignature) return { dir: sourceDir, snapshotted: false };
  const startedAtMs = Date.now();
  let snapshot: ReturnType<typeof ensureStaticSnapshot>;
  try {
    snapshot = ensureStaticSnapshot({
      sourceDir,
      cacheRoot: Path.join(app.getPath("userData"), "static-snapshots"),
      signature: `${archiveSignature.size}-${archiveSignature.mtimeMs}-${archiveSignature.inode}`,
    });
  } catch (error) {
    const currentArchiveSignature = readBundleSignature(archivePath);
    if (!isBundleStable(archiveSignature, currentArchiveSignature)) {
      throw new BundleChangedDuringStartupError({
        bundlePath: archivePath,
        baseline: archiveSignature,
        current: currentArchiveSignature,
      });
    }
    console.warn(
      "[desktop] Failed to snapshot static assets; serving from the archive",
      formatErrorMessage(error),
    );
    return { dir: sourceDir, snapshotted: false };
  }
  const currentArchiveSignature = readBundleSignature(archivePath);
  if (!isBundleStable(archiveSignature, currentArchiveSignature)) {
    if (!snapshot.reused) {
      try {
        FS.rmSync(snapshot.dir, { recursive: true, force: true });
      } catch {}
    }
    throw new BundleChangedDuringStartupError({
      bundlePath: archivePath,
      baseline: archiveSignature,
      current: currentArchiveSignature,
    });
  }
  writeDesktopLogHeader(
    `static snapshot ${snapshot.reused ? "reused" : "created"} dir=${snapshot.dir} in ${Date.now() - startedAtMs}ms`,
  );
  return { dir: snapshot.dir, snapshotted: true };
}

export function resolveServedStaticRoot(): ServedStaticRoot | null {
  if (servedStaticRootCache === undefined) servedStaticRootCache = computeServedStaticRoot();
  return servedStaticRootCache;
}

function resolveDesktopStaticPath(staticRoot: string, requestUrl: string): string {
  const url = new URL(requestUrl);
  const rawPath = decodeURIComponent(url.pathname);
  const normalizedPath = Path.posix.normalize(rawPath).replace(/^\/+/, "");
  if (normalizedPath.includes("..")) return Path.join(staticRoot, "index.html");
  const resolvedPath = Path.join(staticRoot, normalizedPath || "index.html");
  if (Path.extname(resolvedPath)) return resolvedPath;
  const nestedIndex = Path.join(resolvedPath, "index.html");
  return FS.existsSync(nestedIndex) ? nestedIndex : Path.join(staticRoot, "index.html");
}

function isStaticAssetRequest(requestUrl: string): boolean {
  try {
    return Path.extname(new URL(requestUrl).pathname).length > 0;
  } catch {
    return false;
  }
}

export function registerDesktopProtocol(): void {
  if (isDevelopment || desktopState.desktopProtocolRegistered) return;
  if (startupBundleIdentity && !startupBundleIdentity.signature) {
    throw new BundleChangedDuringStartupError({
      bundlePath: startupBundleIdentity.path,
      baseline: null,
      current: readBundleSignature(startupBundleIdentity.path),
    });
  }
  const staticRoot = resolveServedStaticRoot()?.dir ?? null;
  if (!staticRoot) {
    throw new Error(
      "Desktop static bundle missing. Build apps/server (with bundled client) first.",
    );
  }
  const root = Path.resolve(staticRoot);
  const prefix = `${root}${Path.sep}`;
  const fallbackIndex = Path.join(root, "index.html");
  protocol.registerFileProtocol(DESKTOP_SCHEME, (request, callback) => {
    try {
      const candidate = Path.resolve(resolveDesktopStaticPath(root, request.url));
      const inRoot = candidate === fallbackIndex || candidate.startsWith(prefix);
      if (!inRoot || !FS.existsSync(candidate)) {
        callback(isStaticAssetRequest(request.url) ? { error: -6 } : { path: fallbackIndex });
        return;
      }
      callback({ path: candidate });
    } catch {
      callback({ path: fallbackIndex });
    }
  });
  desktopState.desktopProtocolRegistered = true;
}
