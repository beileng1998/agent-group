import fs from "node:fs/promises";
import path from "node:path";

import type { FilesystemBrowseInput, FilesystemBrowseResult } from "@agent-group/contracts";
import { isExplicitRelativePath, isWindowsAbsolutePath } from "@agent-group/shared/path";
import { expandHomePath } from "./workspaceEntryValues";

function resolveBrowseTarget(input: FilesystemBrowseInput): string {
  if (process.platform !== "win32" && isWindowsAbsolutePath(input.partialPath)) {
    throw new Error("Windows-style paths are only supported on Windows.");
  }

  if (!isExplicitRelativePath(input.partialPath)) {
    return path.resolve(expandHomePath(input.partialPath));
  }

  if (!input.cwd) {
    throw new Error("Relative filesystem browse paths require a current project.");
  }

  return path.resolve(expandHomePath(input.cwd), input.partialPath);
}

export async function browseWorkspaceEntries(
  input: FilesystemBrowseInput,
): Promise<FilesystemBrowseResult> {
  const resolvedInputPath = resolveBrowseTarget(input);
  const endsWithSeparator = /[\\/]$/.test(input.partialPath) || input.partialPath === "~";
  const parentPath = endsWithSeparator ? resolvedInputPath : path.dirname(resolvedInputPath);
  const prefix = endsWithSeparator ? "" : path.basename(resolvedInputPath);

  const dirents = await fs.readdir(parentPath, { withFileTypes: true });

  const showHidden = endsWithSeparator || prefix.startsWith(".");
  const lowerPrefix = prefix.toLowerCase();

  return {
    parentPath,
    entries: dirents
      .filter(
        (dirent) =>
          dirent.isDirectory() &&
          dirent.name.toLowerCase().startsWith(lowerPrefix) &&
          (showHidden || !dirent.name.startsWith(".")),
      )
      .map((dirent) => ({
        name: dirent.name,
        fullPath: path.join(parentPath, dirent.name),
      }))
      .toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}
