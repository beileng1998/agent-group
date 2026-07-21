import fs from "node:fs/promises";
import path from "node:path";

import type {
  ProjectDirectoryEntry,
  ProjectFileSystemEntry,
  ProjectListDirectoriesInput,
  ProjectListDirectoriesResult,
} from "@agent-group/contracts";
import { isWindowsAbsolutePath } from "@agent-group/shared/path";
import { resolveRealPathWithinRoot } from "../workspace/realPathContainment";
import { mapWithConcurrency, toPosixPath } from "./workspaceEntryValues";

async function directoryHasChildDirectories(absolutePath: string): Promise<boolean> {
  try {
    const dirents = await fs.readdir(absolutePath, { withFileTypes: true });
    return dirents.some(
      (dirent) => dirent.isDirectory() && dirent.name !== "." && dirent.name !== "..",
    );
  } catch {
    return false;
  }
}

// Resolve a client-supplied relative directory against the workspace root and
// refuse anything that escapes it (absolute paths, "..", "a/../../b", ...).
// Same containment rule as WorkspacePaths.resolveRelativePathWithinRoot, but
// the workspace root itself (empty relative path) is a valid listing target.
function resolveDirectoryWithinRoot(cwd: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || isWindowsAbsolutePath(relativePath)) {
    throw new Error("Directory path is outside the workspace root.");
  }
  const absolutePath = path.resolve(cwd, relativePath);
  const relativeToRoot = path.relative(cwd, absolutePath);
  if (
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error("Directory path is outside the workspace root.");
  }
  return absolutePath;
}

export async function listWorkspaceDirectories(
  input: ProjectListDirectoriesInput,
): Promise<ProjectListDirectoriesResult> {
  const relativePath = input.relativePath?.trim() ?? "";
  const resolvedTarget = relativePath
    ? resolveDirectoryWithinRoot(input.cwd, relativePath)
    : input.cwd;
  // String containment above cannot see symlinks; re-check on canonical paths.
  const targetDirectory = await resolveRealPathWithinRoot(input.cwd, resolvedTarget);
  if (targetDirectory === null) {
    throw new Error("Directory path is outside the workspace root.");
  }
  const dirents = await fs.readdir(targetDirectory, { withFileTypes: true });
  const entries = await mapWithConcurrency(
    dirents
      .filter(
        (dirent) =>
          dirent.name.length > 0 &&
          dirent.name !== "." &&
          dirent.name !== ".." &&
          dirent.name !== ".git" &&
          (dirent.isDirectory() || (input.includeFiles === true && dirent.isFile())),
      )
      .toSorted((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      }),
    16,
    async (dirent) => {
      const childRelativePath = toPosixPath(
        relativePath ? path.join(relativePath, dirent.name) : dirent.name,
      );
      if (dirent.isDirectory()) {
        const childAbsolutePath = path.join(input.cwd, childRelativePath);
        return {
          path: childRelativePath,
          name: dirent.name,
          kind: "directory",
          ...(relativePath ? { parentPath: relativePath } : {}),
          hasChildren: await directoryHasChildDirectories(childAbsolutePath),
        } satisfies ProjectDirectoryEntry & ProjectFileSystemEntry;
      }
      return {
        path: childRelativePath,
        name: dirent.name,
        kind: "file",
        ...(relativePath ? { parentPath: relativePath } : {}),
      } satisfies ProjectFileSystemEntry;
    },
  );

  return { entries };
}
