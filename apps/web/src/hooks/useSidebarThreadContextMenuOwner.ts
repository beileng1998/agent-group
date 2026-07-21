// FILE: useSidebarThreadContextMenuOwner.ts
// Purpose: Own native thread context-menu construction and action dispatch.
// Layer: Web sidebar controller

import {
  PROVIDER_DISPLAY_NAMES,
  type ProjectId,
  type ProviderKind,
  type ThreadId,
} from "@agent-group/contracts";
import { resolveThreadWorkspaceCwd } from "@agent-group/shared/threadEnvironment";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useCopyPathToClipboard, useCopyThreadIdToClipboard } from "./useCopyToClipboard";
import {
  canCreateThreadHandoff,
  resolveAvailableHandoffTargetProviders,
} from "../lib/threadHandoff";
import { quotePosixShellArgument } from "../lib/shellQuote";
import { randomUUID } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { derivePendingApprovals, derivePendingUserInputs } from "../session-logic";
import { useStore } from "../store";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { getThreadFromState } from "../threadDerivation";
import type { SidebarThreadSummary, Thread } from "../types";
import { DEFAULT_THREAD_TERMINAL_ID } from "../types";
import type { ThreadStatusPill } from "../components/Sidebar.statusLogic";
import { toastManager } from "../components/ui/toast";
import { pinActionLabel } from "../lib/pin";
import { useThreadHandoff } from "./useThreadHandoff";

interface ThreadContextMenuExtraOptions {
  readonly extraItems?: Array<{
    readonly id: "return-to-single-chat";
    readonly label: string;
  }>;
  readonly onExtraAction?: (itemId: "return-to-single-chat") => Promise<void> | void;
}

interface UseSidebarThreadContextMenuOwnerInput {
  readonly sidebarThreadSummaryById: Readonly<Record<string, SidebarThreadSummary>>;
  readonly pinnedThreadIdSet: ReadonlySet<ThreadId>;
  readonly projectCwdById: ReadonlyMap<ProjectId, string>;
  readonly resolveThreadStatus: (thread: SidebarThreadSummary) => ThreadStatusPill | null;
  readonly openRenameDialog: (threadId: ThreadId) => void;
  readonly toggleThreadPinned: (threadId: ThreadId) => void;
  readonly clearDismissedThreadStatus: (threadId: ThreadId) => void;
  readonly clearThreadNotification: (threadId: ThreadId) => void;
  readonly markThreadUnread: (threadId: ThreadId) => void;
  readonly confirmAndArchiveThread: (threadId: ThreadId) => Promise<void>;
  readonly confirmAndDeleteThread: (threadId: ThreadId) => Promise<void>;
}

export function useSidebarThreadContextMenuOwner({
  sidebarThreadSummaryById,
  pinnedThreadIdSet,
  projectCwdById,
  resolveThreadStatus,
  openRenameDialog,
  toggleThreadPinned,
  clearDismissedThreadStatus,
  clearThreadNotification,
  markThreadUnread,
  confirmAndArchiveThread,
  confirmAndDeleteThread,
}: UseSidebarThreadContextMenuOwnerInput) {
  const navigate = useNavigate();
  const copyThreadIdToClipboard = useCopyThreadIdToClipboard();
  const copyPathToClipboard = useCopyPathToClipboard();
  const { createThreadHandoff } = useThreadHandoff();

  const handoffThread = useCallback(
    async (thread: Thread, targetProvider: ProviderKind) => {
      try {
        await createThreadHandoff(thread, targetProvider);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not create handoff thread",
          description:
            error instanceof Error
              ? error.message
              : "An error occurred while creating the handoff thread.",
        });
      }
    },
    [createThreadHandoff],
  );

  const handleThreadContextMenu = useCallback(
    async (
      threadId: ThreadId,
      position: { x: number; y: number },
      options?: ThreadContextMenuExtraOptions,
    ) => {
      const api = readNativeApi();
      if (!api) return;
      const thread = getThreadFromState(useStore.getState(), threadId);
      if (!thread) return;
      const summary = sidebarThreadSummaryById[threadId];
      const isPinned = pinnedThreadIdSet.has(threadId);
      const hasPendingApprovals =
        summary?.hasPendingApprovals ?? derivePendingApprovals(thread.activities).length > 0;
      const hasPendingUserInput =
        summary?.hasPendingUserInput ?? derivePendingUserInputs(thread.activities).length > 0;
      const canHandoff = canCreateThreadHandoff({
        thread,
        hasPendingApprovals,
        hasPendingUserInput,
      });
      const status = summary ? resolveThreadStatus(summary) : null;
      const handoffTargets = canHandoff
        ? resolveAvailableHandoffTargetProviders(thread.modelSelection.provider)
        : [];
      const handoffItems = handoffTargets.map((provider, index) => ({
        id: `handoff:${provider}`,
        label: `Handoff to ${PROVIDER_DISPLAY_NAMES[provider]}`,
        separatorBefore: index === 0,
      }));
      const threadWorkspacePath = resolveThreadWorkspacePath(
        projectCwdById.get(thread.projectId) ?? null,
        thread,
      );
      const clicked = await api.contextMenu.show(
        [
          { id: "rename", label: "Rename thread" },
          { id: "toggle-pin", label: pinActionLabel("thread", isPinned) },
          ...(status?.dismissible
            ? [{ id: "clear-notification", label: "Clear notification" }]
            : []),
          { id: "mark-unread", label: "Mark unread" },
          ...handoffItems,
          { id: "copy-path", label: "Copy Path", separatorBefore: true },
          ...(threadWorkspacePath
            ? [{ id: "open-path-in-terminal", label: "Open Path in Terminal" }]
            : []),
          { id: "copy-thread-id", label: "Copy Thread ID" },
          ...(options?.extraItems ?? []),
          { id: "archive", label: "Archive", separatorBefore: true },
          { id: "delete", label: "Delete", destructive: true },
        ],
        position,
      );

      if (clicked === "rename") openRenameDialog(threadId);
      else if (clicked === "toggle-pin") toggleThreadPinned(threadId);
      else if (clicked === "mark-unread") {
        clearDismissedThreadStatus(threadId);
        markThreadUnread(threadId);
      } else if (clicked === "clear-notification") clearThreadNotification(threadId);
      else if (typeof clicked === "string" && clicked.startsWith("handoff:")) {
        const targetProvider = clicked.slice("handoff:".length);
        if (handoffTargets.includes(targetProvider as ProviderKind)) {
          await handoffThread(thread, targetProvider as ProviderKind);
        }
      } else if (clicked === "copy-path") {
        if (!threadWorkspacePath) {
          toastManager.add({
            type: "error",
            title: "Path unavailable",
            description: "This thread does not have a workspace path to copy.",
          });
        } else copyPathToClipboard(threadWorkspacePath);
      } else if (clicked === "open-path-in-terminal") {
        if (!threadWorkspacePath) {
          toastManager.add({
            type: "error",
            title: "Path unavailable",
            description: "This thread does not have a workspace path to open.",
          });
        } else {
          await openPathInTerminal({ api, navigate, threadId, threadWorkspacePath });
        }
      } else if (clicked === "copy-thread-id") copyThreadIdToClipboard(threadId);
      else if (clicked === "return-to-single-chat") {
        await options?.onExtraAction?.("return-to-single-chat");
      } else if (clicked === "archive") await confirmAndArchiveThread(threadId);
      else if (clicked === "delete") await confirmAndDeleteThread(threadId);
    },
    [
      clearDismissedThreadStatus,
      clearThreadNotification,
      confirmAndArchiveThread,
      confirmAndDeleteThread,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      handoffThread,
      markThreadUnread,
      navigate,
      openRenameDialog,
      pinnedThreadIdSet,
      projectCwdById,
      resolveThreadStatus,
      sidebarThreadSummaryById,
      toggleThreadPinned,
    ],
  );

  return { handleThreadContextMenu };
}

function resolveThreadWorkspacePath(projectCwd: string | null, thread: Thread): string | null {
  return resolveThreadWorkspaceCwd({
    projectCwd,
    envMode: thread.envMode,
    worktreePath: thread.worktreePath,
  });
}

async function openPathInTerminal(input: {
  api: NonNullable<ReturnType<typeof readNativeApi>>;
  navigate: ReturnType<typeof useNavigate>;
  threadId: ThreadId;
  threadWorkspacePath: string;
}) {
  await input.navigate({ to: "/$threadId", params: { threadId: input.threadId } });
  const terminalStore = useTerminalStateStore.getState();
  const current = selectThreadTerminalState(terminalStore.terminalStateByThreadId, input.threadId);
  const baseTerminalId =
    current.activeTerminalId || current.terminalIds[0] || DEFAULT_THREAD_TERMINAL_ID;
  const baseAvailable =
    current.terminalOpen &&
    current.terminalIds.includes(baseTerminalId) &&
    !current.runningTerminalIds.includes(baseTerminalId);
  const shouldCreateNewTerminal = !baseAvailable;
  const targetTerminalId = shouldCreateNewTerminal ? `terminal-${randomUUID()}` : baseTerminalId;
  const previousTerminalOpen = current.terminalOpen;
  const previousPresentationMode = current.presentationMode;
  const previousActiveTerminalId = current.activeTerminalId;
  terminalStore.setTerminalPresentationMode(input.threadId, "drawer");
  terminalStore.setTerminalOpen(input.threadId, true);
  if (shouldCreateNewTerminal) terminalStore.newTerminal(input.threadId, targetTerminalId);
  else terminalStore.setActiveTerminal(input.threadId, targetTerminalId);

  try {
    if (shouldCreateNewTerminal) {
      await input.api.terminal.open({
        threadId: input.threadId,
        terminalId: targetTerminalId,
        cwd: input.threadWorkspacePath,
      });
    }
    await input.api.terminal.write({
      threadId: input.threadId,
      terminalId: targetTerminalId,
      data: `cd ${quotePosixShellArgument(input.threadWorkspacePath)}\r`,
    });
  } catch (error) {
    if (shouldCreateNewTerminal) terminalStore.closeTerminal(input.threadId, targetTerminalId);
    terminalStore.setTerminalPresentationMode(input.threadId, previousPresentationMode);
    terminalStore.setTerminalOpen(input.threadId, previousTerminalOpen);
    if (previousActiveTerminalId) {
      terminalStore.setActiveTerminal(input.threadId, previousActiveTerminalId);
    }
    toastManager.add({
      type: "error",
      title: "Unable to open terminal",
      description: error instanceof Error ? error.message : "The terminal could not be opened.",
    });
  }
}
