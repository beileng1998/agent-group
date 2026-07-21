import fs from "node:fs/promises";
import path from "node:path";

import {
  getEditorWindowsStorePackages,
  resolveWindowsStorePackageInstallLocation,
} from "../editorAppDiscovery";
import {
  directoryExists,
  fileExists,
  resolveCommandPath,
  type EditorIconSource,
  type EditorIconSourceInput,
} from "./editorIconShared";

const MAX_WINDOWS_PACKAGE_ICON_FILES_TO_SCAN = 1_200;

function scoreWindowsStoreIconPath(iconPath: string): number | null {
  const name = path.basename(iconPath).toLowerCase();
  const extension = path.extname(name);
  if (extension !== ".png" && extension !== ".svg") return null;

  let score = extension === ".png" ? 0 : 20;
  if (name.includes("square44x44logo")) {
    score += 0;
  } else if (name.includes("appicon") || name.includes("logo")) {
    score += 10;
  } else {
    score += 50;
  }

  if (name.includes("unplated")) score -= 3;
  if (name.includes("targetsize-256") || name.includes("scale-200")) score -= 2;
  if (name.includes("targetsize-48") || name.includes("scale-100")) score -= 1;
  return score;
}

async function findWindowsStorePackageIcon(packageDir: string): Promise<string | null> {
  const roots = Array.from(new Set([path.join(packageDir, "Assets"), packageDir]));
  let best: { path: string; score: number } | null = null;
  let scanned = 0;

  for (const root of roots) {
    if (!(await directoryExists(root))) continue;
    const pendingDirs = [root];
    while (pendingDirs.length > 0) {
      const currentDir = pendingDirs.pop();
      if (!currentDir) continue;
      const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (++scanned > MAX_WINDOWS_PACKAGE_ICON_FILES_TO_SCAN) return best?.path ?? null;
        const candidate = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          pendingDirs.push(candidate);
          continue;
        }
        if (!(await fileExists(candidate))) continue;
        const score = scoreWindowsStoreIconPath(candidate);
        if (score === null) continue;
        if (!best || score < best.score) best = { path: candidate, score };
      }
    }
  }

  return best?.path ?? null;
}

async function resolveWindowsStoreEditorIconSource(
  input: EditorIconSourceInput,
): Promise<EditorIconSource | null> {
  const packages = getEditorWindowsStorePackages(input.editor);
  const findIconSource = async (packageDir: string): Promise<EditorIconSource | null> => {
    const iconPath = await findWindowsStorePackageIcon(packageDir);
    if (!iconPath) return null;
    const extension = path.extname(iconPath).toLowerCase();
    if (extension === ".svg") {
      return {
        sourcePath: iconPath,
        outputExtension: "svg",
        contentType: "image/svg+xml",
        transform: "copy",
      };
    }

    return {
      sourcePath: iconPath,
      outputExtension: "png",
      contentType: "image/png",
      transform: "copy",
    };
  };

  const appxPackageDir = resolveWindowsStorePackageInstallLocation(
    packages,
    input.platform,
    input.env,
  );
  if (appxPackageDir) return findIconSource(appxPackageDir);

  return null;
}

export async function resolveWindowsEditorIconSource(
  input: EditorIconSourceInput,
): Promise<EditorIconSource | null> {
  if (input.platform !== "win32") return null;
  const storeSource = await resolveWindowsStoreEditorIconSource(input);
  if (storeSource) return storeSource;

  const exePath = await resolveCommandPath({
    commands: input.editor.commands ?? null,
    platform: input.platform,
    env: input.env,
  });
  if (!exePath) return null;
  return {
    sourcePath: exePath,
    outputExtension: "png",
    contentType: "image/png",
    transform: "windows-associated-icon",
  };
}
