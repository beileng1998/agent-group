import type { ThreadId } from "@agent-group/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import {
  addChatFileComment,
  appendChatFileReference,
  appendComposerPromptText,
  buildWhyLinesPrompt,
  type ChatFileReference,
} from "../lib/chatReferences";
import type { FileCommentSelection } from "../lib/fileComments";
import {
  prefetchWorkspaceFile,
  resolveDockFileOpenTarget,
  resolveWorkspaceFileOpenTarget,
  type WorkspaceFileOpener,
} from "../lib/workspaceFileOpener";

export function useSingleChatWorkspaceBridge(input: {
  threadId: ThreadId;
  workspaceRoot: string | null;
  openDockFile: (filePath: string) => void;
  selectEditorFile: (filePath: string) => void;
}) {
  const queryClient = useQueryClient();

  const handleReferenceInChat = useCallback(
    (reference: ChatFileReference) => {
      appendChatFileReference(input.threadId, reference);
    },
    [input.threadId],
  );
  const handleAskWhyInChat = useCallback(
    (reference: ChatFileReference) => {
      appendComposerPromptText(input.threadId, buildWhyLinesPrompt(reference));
    },
    [input.threadId],
  );
  const handleCommentInChat = useCallback(
    (comment: FileCommentSelection) => {
      addChatFileComment(input.threadId, comment);
    },
    [input.threadId],
  );

  // Hover warm-up shared by both surfaces' file openers: file contents land in
  // the React Query cache and the matching Shiki highlighter loads, so the
  // preview paints instantly on click.
  const prefetchOpenerFile = useCallback(
    (path: string) => {
      if (!input.workspaceRoot) {
        return;
      }
      const relativePath = resolveWorkspaceFileOpenTarget(path, input.workspaceRoot);
      if (relativePath) {
        prefetchWorkspaceFile(queryClient, input.workspaceRoot, relativePath);
      }
    },
    [input.workspaceRoot, queryClient],
  );

  // Chat surface: file references open in the right-dock file pane. References
  // outside the workspace report unhandled so chips fall back to the external
  // editor. Absolute scratch-preview paths remain valid dock targets.
  const dockFileOpener = useMemo<WorkspaceFileOpener>(
    () => ({
      openFile: (path) => {
        const targetPath = resolveDockFileOpenTarget(path, input.workspaceRoot);
        if (!targetPath) {
          return false;
        }
        input.openDockFile(targetPath);
        return true;
      },
      prefetchFile: prefetchOpenerFile,
    }),
    [input.openDockFile, input.workspaceRoot, prefetchOpenerFile],
  );

  // Editor surface: the center file pane is already the file viewer, so file
  // references select into it instead of opening a dock pane.
  const editorFileOpener = useMemo<WorkspaceFileOpener>(
    () => ({
      openFile: (path) => {
        if (!input.workspaceRoot) {
          return false;
        }
        const relativePath = resolveWorkspaceFileOpenTarget(path, input.workspaceRoot);
        if (!relativePath) {
          return false;
        }
        input.selectEditorFile(relativePath);
        return true;
      },
      prefetchFile: prefetchOpenerFile,
    }),
    [input.selectEditorFile, input.workspaceRoot, prefetchOpenerFile],
  );

  return {
    handleReferenceInChat,
    handleAskWhyInChat,
    handleCommentInChat,
    dockFileOpener,
    editorFileOpener,
  };
}
