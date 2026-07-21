import type { ProjectFileSystemEntry, ProjectLocalSearchEntry } from "@agent-group/contracts";

export function detectPathSeparator(value: string): "/" | "\\" {
  return value.includes("\\") ? "\\" : "/";
}

export function joinDirectoryPath(directoryPath: string, childName: string): string {
  if (!childName) return directoryPath;
  const separator = detectPathSeparator(directoryPath);
  const needsSeparator = !directoryPath.endsWith(separator);
  return `${directoryPath}${needsSeparator ? separator : ""}${childName}`;
}

function isTildeRoot(directoryPath: string): boolean {
  return directoryPath === "~/" || directoryPath === "~\\";
}

export function parentDirectory(directoryPath: string): string | null {
  if (!directoryPath) return null;
  if (directoryPath === "/") return null;
  if (/^[A-Za-z]:[\\/]$/.test(directoryPath)) return null;
  if (isTildeRoot(directoryPath)) return null;

  const separator = detectPathSeparator(directoryPath);
  const trimmed = directoryPath.endsWith(separator) ? directoryPath.slice(0, -1) : directoryPath;
  const lastIndex = trimmed.lastIndexOf(separator);
  if (lastIndex === -1) return null;
  if (lastIndex === 0) return "/";

  const parentSlice = trimmed.slice(0, lastIndex);
  if (/^[A-Za-z]:$/.test(parentSlice) || parentSlice === "~") {
    return `${parentSlice}${separator}`;
  }
  return parentSlice;
}

export function deriveDirectoryAndFilter(mentionQuery: string): {
  directory: string;
  filter: string;
} {
  const slashIndex = Math.max(mentionQuery.lastIndexOf("/"), mentionQuery.lastIndexOf("\\"));
  if (slashIndex === -1) {
    return { directory: "/", filter: mentionQuery };
  }
  const before = mentionQuery.slice(0, slashIndex);
  const after = mentionQuery.slice(slashIndex + 1);
  if (before === "" || /^[A-Za-z]:$/.test(before) || before === "~") {
    return { directory: mentionQuery.slice(0, slashIndex + 1), filter: after };
  }
  return { directory: before, filter: after };
}

export function basename(value: string): string {
  const parts = value.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? value;
}

export function isRootDirectory(directoryPath: string): boolean {
  if (directoryPath === "/") return true;
  if (/^[A-Za-z]:[\\/]$/.test(directoryPath)) return true;
  if (isTildeRoot(directoryPath)) return true;
  return false;
}

export function summarizeDirectoryLoadError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (/ENOENT|no such file or directory/i.test(raw)) return "Folder not found.";
  if (/EACCES|permission denied/i.test(raw)) return "Permission denied.";
  if (/ENOTDIR|not a directory/i.test(raw)) return "Not a folder.";
  return "Unable to load folders.";
}

export function filterLocalEntries(
  entries: readonly ProjectFileSystemEntry[] | undefined,
  filter: string,
): { folders: ProjectFileSystemEntry[]; files: ProjectFileSystemEntry[] } {
  const normalizedFilter = filter.trim();
  const lowerFilter = normalizedFilter.toLowerCase();
  const includeDotfiles = normalizedFilter.startsWith(".");
  const folders: ProjectFileSystemEntry[] = [];
  const files: ProjectFileSystemEntry[] = [];
  for (const entry of entries ?? []) {
    if (!includeDotfiles && entry.name.startsWith(".")) continue;
    if (lowerFilter.length > 0 && !entry.name.toLowerCase().includes(lowerFilter)) continue;
    if (entry.kind === "directory") folders.push(entry);
    else files.push(entry);
  }
  return { folders, files };
}

export function buildSearchRowSubtitle(entry: ProjectLocalSearchEntry, rootPath: string): string {
  const parent = entry.parentPath ?? "";
  if (!parent) return "";
  if (rootPath.length > 0 && parent.startsWith(rootPath)) {
    const relative = parent.slice(rootPath.length);
    if (relative.length === 0) return "";
    if (relative.startsWith("/") || relative.startsWith("\\")) return relative;
    return `/${relative}`;
  }
  return parent;
}
