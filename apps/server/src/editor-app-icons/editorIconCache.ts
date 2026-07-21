import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { EDITORS, type EditorId } from "@agent-group/contracts";

import type { EditorDefinition } from "../editorAppDiscovery";
import {
  execFileAsync,
  fileExists,
  ICON_MAX_DIMENSION_PX,
  resolvePathEnvironmentVariable,
  type CachedEditorIcon,
  type EditorIconSource,
} from "./editorIconShared";
import { resolveEditorIconSource } from "./editorIconSources";

// Editors installed as CLI-only (no app bundle / desktop icon) never resolve a
// native icon. Cache that "structural" miss long enough to avoid re-running the
// subprocess + filesystem scans on every menu open, while still picking up a
// freshly installed editor within a few minutes.
const NEGATIVE_ICON_CACHE_TTL_MS = 300_000; // 5 min

const inFlight = new Map<string, Promise<CachedEditorIcon | null>>();
const negativeCache = new Map<string, number>();

function resolveEditor(editorId: string): EditorDefinition | null {
  return EDITORS.find((editor) => editor.id === editorId) ?? null;
}

function sanitizeCacheToken(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
}

async function cacheFileForSource(input: {
  readonly editorId: EditorId;
  readonly cacheDir: string;
  readonly source: EditorIconSource;
}): Promise<string> {
  const stat = await fs.stat(input.source.sourcePath);
  const hash = crypto
    .createHash("sha256")
    .update(input.editorId)
    .update("\0")
    .update(input.source.sourcePath)
    .update("\0")
    .update(String(stat.mtimeMs))
    .update("\0")
    .update(String(stat.size))
    .digest("hex")
    .slice(0, 16);
  return path.join(
    input.cacheDir,
    `${sanitizeCacheToken(input.editorId)}-${hash}.${input.source.outputExtension}`,
  );
}

async function materializeCachedIcon(input: {
  readonly source: EditorIconSource;
  readonly outputPath: string;
}): Promise<void> {
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });

  // Build into a unique temp file, then atomically rename into place. This keeps
  // HTTP readers and concurrent resolvers (distinct env keys can map to the same
  // source/output) from ever observing a half-written icon file.
  const tempPath = `${input.outputPath}.${crypto.randomUUID()}.tmp`;
  try {
    await writeIconArtifact({ source: input.source, outputPath: tempPath });
    await fs.rename(tempPath, input.outputPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    // A concurrent resolver may have won the rename race (notably on Windows,
    // where renaming onto an existing file throws). If the output now exists,
    // the icon is materialized regardless of who wrote it.
    if (await fileExists(input.outputPath)) return;
    throw error;
  }
}

async function writeIconArtifact(input: {
  readonly source: EditorIconSource;
  readonly outputPath: string;
}): Promise<void> {
  if (input.source.transform === "copy") {
    await fs.copyFile(input.source.sourcePath, input.outputPath);
    return;
  }

  if (input.source.transform === "sips-icns") {
    // Convert .icns -> png and downscale to the display cap in a single pass.
    await execFileAsync("sips", [
      "-s",
      "format",
      "png",
      "-Z",
      String(ICON_MAX_DIMENSION_PX),
      input.source.sourcePath,
      "--out",
      input.outputPath,
    ]);
    return;
  }

  const escapedSource = input.source.sourcePath.replaceAll("'", "''");
  const escapedOutput = input.outputPath.replaceAll("'", "''");
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    `$icon = [System.Drawing.Icon]::ExtractAssociatedIcon('${escapedSource}')`,
    "if ($null -eq $icon) { exit 2 }",
    "$bitmap = $icon.ToBitmap()",
    `$bitmap.Save('${escapedOutput}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    "$bitmap.Dispose()",
    "$icon.Dispose()",
  ].join("; ");
  await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script]);
}

async function resolveCachedEditorIconUncached(input: {
  readonly editorId: string;
  readonly cacheDir: string;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<CachedEditorIcon | null> {
  const editor = resolveEditor(input.editorId);
  if (!editor) return null;
  const source = await resolveEditorIconSource({
    editor,
    platform: input.platform ?? process.platform,
    env: input.env ?? process.env,
  });
  if (!source) return null;

  const outputPath = await cacheFileForSource({
    editorId: editor.id,
    cacheDir: input.cacheDir,
    source,
  });
  if (!(await fileExists(outputPath))) {
    await materializeCachedIcon({ source, outputPath });
  }
  return { path: outputPath, contentType: source.contentType };
}

function iconLookupCacheKey(input: {
  readonly editorId: string;
  readonly cacheDir: string;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
}): string {
  const env = input.env ?? process.env;
  return [
    input.platform ?? process.platform,
    input.editorId,
    input.cacheDir,
    env.HOME ?? "",
    env.XDG_DATA_HOME ?? "",
    env.XDG_DATA_DIRS ?? "",
    env.LOCALAPPDATA ?? "",
    env.ProgramFiles ?? "",
    env.ProgramW6432 ?? "",
    env.SystemDrive ?? "",
    resolvePathEnvironmentVariable(env),
    env.PATHEXT ?? "",
  ].join("\0");
}

export async function resolveCachedEditorIcon(input: {
  readonly editorId: string;
  readonly cacheDir: string;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<CachedEditorIcon | null> {
  const key = iconLookupCacheKey(input);
  const negativeUntil = negativeCache.get(key);
  if (negativeUntil !== undefined) {
    if (negativeUntil > Date.now()) return null;
    negativeCache.delete(key);
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = resolveCachedEditorIconUncached(input)
    .catch(() => null)
    .then((icon) => {
      if (icon) {
        negativeCache.delete(key);
      } else {
        negativeCache.set(key, Date.now() + NEGATIVE_ICON_CACHE_TTL_MS);
      }
      return icon;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

export function clearEditorIconInFlightCache(): void {
  inFlight.clear();
  negativeCache.clear();
}
