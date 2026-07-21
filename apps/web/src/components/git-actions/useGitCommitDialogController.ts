import { useCallback, useMemo, useState } from "react";

import { openInPreferredEditor } from "~/editorPreferences";
import { resolvePathLinkTarget } from "~/terminal-links";
import { readNativeApi } from "~/nativeApi";
import { toastManager } from "../ui/toast";
import type { GitCommitDialogModel } from "./GitActionDialogs";
import type { GitRepositoryActionState } from "./useGitRepositoryActionState";
import type { GitStackedActionController } from "./useGitStackedActionController";

export function useGitCommitDialogController(input: {
  gitCwd: string | null;
  repository: GitRepositoryActionState;
  stacked: GitStackedActionController;
}) {
  const [open, setOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [excludedFiles, setExcludedFiles] = useState<ReadonlySet<string>>(new Set());
  const [isEditingFiles, setIsEditingFiles] = useState(false);
  const files = input.repository.gitStatusForActions?.workingTree.files ?? [];
  const selectedFiles = useMemo(
    () => files.filter((file) => !excludedFiles.has(file.path)),
    [excludedFiles, files],
  );
  const allSelected = excludedFiles.size === 0;
  const noneSelected = selectedFiles.length === 0;

  const reset = useCallback(() => {
    setOpen(false);
    setCommitMessage("");
    setExcludedFiles(new Set());
    setIsEditingFiles(false);
  }, []);

  const openDialog = useCallback(() => {
    setExcludedFiles(new Set());
    setIsEditingFiles(false);
    setOpen(true);
  }, []);

  const runCommit = useCallback(
    (featureBranch: boolean) => {
      if (!open) return;
      const message = commitMessage.trim();
      reset();
      void input.stacked.run({
        action: "commit",
        ...(message ? { commitMessage: message } : {}),
        ...(!allSelected ? { filePaths: selectedFiles.map((file) => file.path) } : {}),
        ...(featureBranch ? { featureBranch: true, skipDefaultBranchPrompt: true } : {}),
      });
    },
    [allSelected, commitMessage, input.stacked, open, reset, selectedFiles],
  );

  const openFile = useCallback(
    (filePath: string) => {
      const api = readNativeApi();
      if (!api || !input.gitCwd) {
        toastManager.add({
          type: "error",
          title: "Editor opening is unavailable.",
          data: input.repository.threadToastData,
        });
        return;
      }
      const target = resolvePathLinkTarget(filePath, input.gitCwd);
      void openInPreferredEditor(api, target).catch((error) => {
        toastManager.add({
          type: "error",
          title: "Unable to open file",
          description: error instanceof Error ? error.message : "An error occurred.",
          data: input.repository.threadToastData,
        });
      });
    },
    [input.gitCwd, input.repository.threadToastData],
  );

  const dialog: GitCommitDialogModel = {
    open,
    branchName: input.repository.gitStatusForActions?.branch ?? null,
    isDefaultBranch: input.repository.isDefaultBranch,
    files,
    selectedFiles,
    excludedFiles,
    allSelected,
    noneSelected,
    isEditingFiles,
    commitMessage,
    onOpenChange: (nextOpen) => {
      if (!nextOpen) reset();
    },
    onToggleAllFiles: () =>
      setExcludedFiles(allSelected ? new Set(files.map((file) => file.path)) : new Set()),
    onToggleFile: (filePath) =>
      setExcludedFiles((previous) => {
        const next = new Set(previous);
        if (next.has(filePath)) next.delete(filePath);
        else next.add(filePath);
        return next;
      }),
    onToggleEditingFiles: () => setIsEditingFiles((value) => !value),
    onCommitMessageChange: setCommitMessage,
    onOpenFile: openFile,
    onCommitOnNewBranch: () => runCommit(true),
    onCommit: () => runCommit(false),
  };

  return { dialog, openDialog };
}
