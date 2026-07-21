import {
  isSupportedLocalImagePath,
  isSupportedLocalPdfPath,
  lowerCaseExtensionOf,
} from "@agent-group/shared/localPreviewFiles";
import {
  isLocalAbsolutePath,
  isWorkspaceRelativePathSafe,
  joinWorkspaceRelativePath,
} from "@agent-group/shared/path";
import { isScratchWorkspacePath } from "@agent-group/shared/threadWorkspace";
import type { ReactNode } from "react";

import type { ChatFileReference } from "~/lib/chatReferences";
import type { FileCommentSelection } from "~/lib/fileComments";

const MARKDOWN_PREVIEW_EXTENSIONS = new Set([".markdown", ".md", ".mdx"]);

export interface WorkspaceFilePreviewProps {
  workspaceRoot: string | null;
  /**
   * Workspace-relative path of the previewed file. Binary previews (images,
   * PDFs) may instead be absolute paths outside the workspace — e.g. a
   * session's scratch directory — served by the local-image route, which never
   * touch the workspace-relative file-read RPC.
   */
  filePath: string | null;
  /**
   * Initial markdown render mode per file: the dock opens markdown already
   * parsed, the editor surface stays source-first. The header toggle still
   * lets the user flip either way.
   */
  markdownPreviewDefault?: boolean;
  /** Shown when no file is selected yet. */
  emptyState?: ReactNode;
  onReferenceInChat?: ((reference: ChatFileReference) => void) | undefined;
  onAskWhyInChat?: ((reference: ChatFileReference) => void) | undefined;
  onCommentInChat?: ((comment: FileCommentSelection) => void) | undefined;
}

export interface WorkspaceFilePreviewKind {
  isImage: boolean;
  isPdf: boolean;
  isLocalAbsolute: boolean;
  isWorkspaceRelative: boolean;
  isScratchBinaryPreview: boolean;
  needsLocalPreviewGrant: boolean;
  isMarkdown: boolean;
}

export function isMarkdownPreviewablePath(filePath: string): boolean {
  const extension = lowerCaseExtensionOf(filePath);
  return extension !== null && MARKDOWN_PREVIEW_EXTENSIONS.has(extension);
}

export function classifyWorkspaceFilePreview(filePath: string | null): WorkspaceFilePreviewKind {
  const isImage = filePath !== null && isSupportedLocalImagePath(filePath);
  const isPdf = filePath !== null && isSupportedLocalPdfPath(filePath);
  const isLocalAbsolute = filePath !== null && isLocalAbsolutePath(filePath);
  const isWorkspaceRelative = filePath !== null && isWorkspaceRelativePathSafe(filePath);
  const isScratchBinaryPreview =
    filePath !== null && (isImage || isPdf) && isScratchWorkspacePath(filePath);

  return {
    isImage,
    isPdf,
    isLocalAbsolute,
    isWorkspaceRelative,
    isScratchBinaryPreview,
    needsLocalPreviewGrant: filePath !== null && isLocalAbsolute && !isScratchBinaryPreview,
    isMarkdown: filePath !== null && isMarkdownPreviewablePath(filePath),
  };
}

function parentDirectoryFromPath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");
  const separatorIndex = normalized.lastIndexOf("/");
  if (separatorIndex <= 0) {
    return null;
  }
  return normalized.slice(0, separatorIndex);
}

export function markdownPreviewCwd(
  workspaceRoot: string | null,
  filePath: string,
): string | undefined {
  const parentDirectory = parentDirectoryFromPath(filePath);
  if (isLocalAbsolutePath(filePath)) {
    return parentDirectory ?? undefined;
  }
  if (!workspaceRoot) {
    return undefined;
  }
  if (!parentDirectory) {
    return workspaceRoot;
  }
  return joinWorkspaceRelativePath(workspaceRoot, parentDirectory);
}
