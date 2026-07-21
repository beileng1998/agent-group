// FILE: projectPickerValues.ts
// Purpose: Defines ProjectPicker contracts and path/search normalization helpers.
// Layer: Web chat project picker

import type { ProjectDirectoryEntry, ProjectId } from "@agent-group/contracts";

export interface ProjectPickerProps {
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
  selectionMode?: "workspace-root" | "project";
  showResetToHome?: boolean;
  selectedProjectId?: ProjectId | null;
  selectedWorkspaceRoot?: string | null;
  onSelectProject?: ((projectId: ProjectId) => void | Promise<void>) | undefined;
  onSelectWorkspaceRoot?: ((workspaceRoot: string) => void) | undefined;
  onCreateProjectFromPath?: ((workspaceRoot: string) => void | Promise<void>) | undefined;
  onResetToHome?: (() => void | Promise<void>) | undefined;
  triggerClassName?: string;
}

export interface ActiveFolderOption {
  projectId: ProjectId | null;
  cwd: string;
  primaryLabel: string;
  secondaryLabel: string | null;
}

export function basenameOfPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const basename = separatorIndex === -1 ? normalized : normalized.slice(separatorIndex + 1);
  return basename.length > 0 ? basename : null;
}

export function directorySearchHaystack(entry: ProjectDirectoryEntry): string {
  return [entry.name, entry.path].join(" ").toLowerCase();
}

export function joinDirectoryPath(rootPath: string, relativePath: string): string {
  if (!relativePath) return rootPath;
  const separator = rootPath.includes("\\") ? "\\" : "/";
  const normalizedRoot = rootPath.endsWith(separator) ? rootPath.slice(0, -1) : rootPath;
  const normalizedRelative = relativePath.split(/[\\/]+/).join(separator);
  return `${normalizedRoot}${separator}${normalizedRelative}`;
}

export function getNavigatorPlatform(): string {
  const navigatorLike = globalThis.navigator as
    | (Navigator & { userAgentData?: { platform?: string } })
    | undefined;
  return [navigatorLike?.platform, navigatorLike?.userAgentData?.platform]
    .filter(Boolean)
    .join(" ");
}
