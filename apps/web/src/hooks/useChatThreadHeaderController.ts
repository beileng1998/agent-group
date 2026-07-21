// FILE: useChatThreadHeaderController.ts
// Purpose: Own the active thread header presentation and its thread-scoped actions.
// Layer: Web chat controller

import { type ProviderKind, type ServerProviderStatus, type ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { buildThreadBreadcrumbs, resolveActiveThreadTitle } from "../components/ChatView.logic";
import { createThreadLineageSelector } from "../components/ChatView.selectors";
import { toastManager } from "../components/ui/toast";
import { findProviderStatus, isProviderUsable } from "../lib/providerAvailability";
import { resolveSubagentPresentationForThread } from "../lib/subagentPresentation";
import {
  canCreateThreadHandoff,
  resolveAvailableHandoffTargetProviders,
  resolveThreadHandoffBadgeLabel,
} from "../lib/threadHandoff";
import { dispatchThreadRename } from "../lib/threadRename";
import { useStore } from "../store";
import type { Thread } from "../types";
import { useThreadHandoff } from "./useThreadHandoff";

export interface ChatThreadHeaderControllerInput {
  readonly thread: {
    readonly active: Thread | undefined;
    readonly isLocalDraft: boolean;
    readonly isHomeChat: boolean;
    readonly isEmpty: boolean;
  };
  readonly handoff: {
    readonly hasProject: boolean;
    readonly isServerThread: boolean;
    readonly isBusy: boolean;
    readonly hasPendingApprovals: boolean;
    readonly hasPendingUserInput: boolean;
    readonly providerStatuses: readonly ServerProviderStatus[];
  };
  readonly banners: {
    readonly rateLimitDismissalKey: string | null;
    readonly setDismissedRateLimitBannerKey: (key: string) => void;
    readonly setThreadError: (threadId: ThreadId, error: string | null) => void;
  };
}

export function useChatThreadHeaderController(input: ChatThreadHeaderControllerInput) {
  const activeThread = input.thread.active;
  const { createThreadHandoff } = useThreadHandoff();
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  useEffect(() => {
    setRenameDialogOpen(false);
  }, [activeThread?.id]);
  const threadLineageThreads = useStore(
    useMemo(() => createThreadLineageSelector(activeThread?.id ?? null), [activeThread?.id]),
  );

  const presentation = useMemo(() => {
    const breadcrumbs = buildThreadBreadcrumbs(threadLineageThreads, activeThread);
    if (!activeThread) {
      return {
        activeThreadTitle: "",
        threadBreadcrumbs: breadcrumbs,
      };
    }

    const subagentTitle = activeThread.parentThreadId
      ? resolveSubagentPresentationForThread({
          thread: activeThread,
          threads: threadLineageThreads,
        }).fullLabel
      : null;

    return {
      activeThreadTitle: resolveActiveThreadTitle({
        title: activeThread.title,
        subagentTitle,
        isHomeChat: input.thread.isHomeChat,
        isEmpty: input.thread.isEmpty,
      }),
      threadBreadcrumbs: breadcrumbs,
    };
  }, [activeThread, input.thread.isEmpty, input.thread.isHomeChat, threadLineageThreads]);

  const handoffDisabled = !(
    activeThread &&
    input.handoff.hasProject &&
    input.handoff.isServerThread &&
    canCreateThreadHandoff({
      thread: activeThread,
      isBusy: input.handoff.isBusy,
      hasPendingApprovals: input.handoff.hasPendingApprovals,
      hasPendingUserInput: input.handoff.hasPendingUserInput,
    })
  );
  const handoffTargetProviders = useMemo(
    () =>
      activeThread
        ? resolveAvailableHandoffTargetProviders(activeThread.modelSelection.provider).filter(
            (provider) =>
              isProviderUsable(findProviderStatus(input.handoff.providerStatuses, provider)),
          )
        : [],
    [activeThread, input.handoff.providerStatuses],
  );
  const createHandoff = useCallback(
    async (targetProvider: ProviderKind) => {
      if (!activeThread || handoffDisabled) {
        return;
      }

      try {
        await createThreadHandoff(activeThread, targetProvider);
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
    [activeThread, createThreadHandoff, handoffDisabled],
  );
  const handoff = useMemo(
    () => ({
      badge: {
        label: activeThread ? resolveThreadHandoffBadgeLabel(activeThread) : null,
        sourceProvider: activeThread?.handoff?.sourceProvider ?? null,
        targetProvider: activeThread?.handoff ? activeThread.modelSelection.provider : null,
      },
      action: {
        label: activeThread ? "Hand off thread" : "Create handoff thread",
        disabled: handoffDisabled,
        targetProviders: handoffTargetProviders,
        create: createHandoff,
      },
    }),
    [activeThread, createHandoff, handoffDisabled, handoffTargetProviders],
  );

  const openRenameDialog = useCallback(() => {
    if (!activeThread) {
      return;
    }
    setRenameDialogOpen(true);
  }, [activeThread]);
  const saveRename = useCallback(
    async (newTitle: string) => {
      if (!activeThread) {
        return;
      }

      const outcome = await dispatchThreadRename({
        threadId: activeThread.id,
        newTitle,
        unchangedTitles: [activeThread.title],
        createIfMissing: input.thread.isLocalDraft
          ? {
              projectId: activeThread.projectId,
              modelSelection: activeThread.modelSelection,
              runtimeMode: activeThread.runtimeMode,
              interactionMode: activeThread.interactionMode,
              envMode: activeThread.envMode ?? "local",
              branch: activeThread.branch,
              worktreePath: activeThread.worktreePath,
              ...(activeThread.lastKnownPr !== undefined
                ? { lastKnownPr: activeThread.lastKnownPr }
                : {}),
              createdAt: activeThread.createdAt,
            }
          : undefined,
      }).catch((error) => {
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
        throw error;
      });

      if (outcome === "empty") {
        toastManager.add({
          type: "warning",
          title: "Thread title cannot be empty",
        });
      }
    },
    [activeThread, input.thread.isLocalDraft],
  );
  const rename = useMemo(
    () => ({
      dialog: {
        open: renameDialogOpen,
        currentTitle: activeThread?.title ?? "",
        onOpenChange: setRenameDialogOpen,
        onSave: saveRename,
      },
      openDialog: openRenameDialog,
    }),
    [activeThread?.title, openRenameDialog, renameDialogOpen, saveRename],
  );

  const dismissThreadError = useCallback(() => {
    if (!activeThread) {
      return;
    }
    input.banners.setThreadError(activeThread.id, null);
  }, [activeThread, input.banners.setThreadError]);
  const dismissRateLimit = useCallback(() => {
    if (!input.banners.rateLimitDismissalKey) {
      return;
    }
    input.banners.setDismissedRateLimitBannerKey(input.banners.rateLimitDismissalKey);
  }, [input.banners.rateLimitDismissalKey, input.banners.setDismissedRateLimitBannerKey]);
  const banners = useMemo(
    () => ({
      threadError: {
        error: activeThread?.error ?? null,
        onDismiss: dismissThreadError,
      },
      rateLimit: {
        onDismiss: dismissRateLimit,
      },
    }),
    [activeThread?.error, dismissRateLimit, dismissThreadError],
  );

  return {
    presentation,
    handoff,
    rename,
    banners,
  };
}
