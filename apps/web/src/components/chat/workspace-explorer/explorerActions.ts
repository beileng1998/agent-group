import type { ProjectFileSystemEntry } from "@agent-group/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  CHAT_FILE_REFERENCE_DRAG_TYPE,
  formatChatFileReference,
  type ChatFileReference,
} from "~/lib/chatReferences";
import { showFileReferenceContextMenu } from "~/lib/fileReferenceContextMenu";
import {
  projectListDirectoriesQueryOptions,
  projectReadFileQueryOptions,
} from "~/lib/projectReactQuery";
import { getSyntaxHighlighterPromise, getSyntaxLanguageForPath } from "~/lib/syntaxHighlighting";

export type ExplorerEntryContextMenuHandler = (
  entry: ProjectFileSystemEntry,
  position: { x: number; y: number },
) => void;

export type ExplorerResultContextMenuHandler = (
  path: string,
  position: { x: number; y: number },
) => void;

// Marks the drag payload so the chat composer can accept it as a reference.
export function setFileReferenceDragData(dataTransfer: DataTransfer, path: string): void {
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(CHAT_FILE_REFERENCE_DRAG_TYPE, formatChatFileReference({ path }));
  dataTransfer.setData("text/plain", path);
}

/**
 * Warms caches for an explorer entry before it is clicked: directory listings
 * for folders, file contents plus the matching syntax highlighter for files.
 */
export function useExplorerEntryPrefetch(cwd: string | null) {
  const queryClient = useQueryClient();
  return useCallback(
    (entry: Pick<ProjectFileSystemEntry, "path" | "kind">) => {
      if (!cwd) {
        return;
      }
      if (entry.kind === "directory") {
        void queryClient.prefetchQuery(
          projectListDirectoriesQueryOptions({
            cwd,
            relativePath: entry.path,
            includeFiles: true,
          }),
        );
        return;
      }
      void queryClient.prefetchQuery(
        projectReadFileQueryOptions({ cwd, relativePath: entry.path }),
      );
      void getSyntaxHighlighterPromise(getSyntaxLanguageForPath(entry.path)).catch(() => undefined);
    },
    [cwd, queryClient],
  );
}

export function useTreeEntryContextMenu(
  onReferenceInChat: ((reference: ChatFileReference) => void) | undefined,
): ExplorerEntryContextMenuHandler {
  return useCallback(
    (entry: ProjectFileSystemEntry, position: { x: number; y: number }) => {
      void showFileReferenceContextMenu({ path: entry.path, position, onReferenceInChat });
    },
    [onReferenceInChat],
  );
}

export function useResultEntryContextMenu(
  onReferenceInChat: ((reference: ChatFileReference) => void) | undefined,
): ExplorerResultContextMenuHandler {
  return useCallback(
    (path: string, position: { x: number; y: number }) => {
      void showFileReferenceContextMenu({ path, position, onReferenceInChat });
    },
    [onReferenceInChat],
  );
}
