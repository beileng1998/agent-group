import type { ThreadId } from "@agent-group/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { type DraftThreadEnvMode, useComposerDraftStore } from "../composerDraftStore";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type Project,
  type Thread,
} from "../types";
import { newThreadId } from "~/lib/utils";

interface PullRequestDialogState {
  initialReference: string | null;
  key: number;
}

export interface PullRequestDraftDialogProps {
  key: number;
  open: true;
  cwd: string | null;
  initialReference: string | null;
  onOpenChange: (open: boolean) => void;
  onPrepared: (input: {
    branch: string;
    worktreePath: string | null;
    pullRequest: NonNullable<Thread["lastKnownPr"]>;
  }) => Promise<void>;
}

export interface UsePullRequestDraftControllerInput {
  threadId: ThreadId;
  project: Pick<Project, "cwd" | "id"> | null | undefined;
  isServerThread: boolean;
  enabled: boolean;
}

export interface PullRequestDraftController {
  open: (reference?: string) => boolean;
  dialogProps: PullRequestDraftDialogProps | null;
}

export function usePullRequestDraftController({
  threadId,
  project,
  isServerThread,
  enabled,
}: UsePullRequestDraftControllerInput): PullRequestDraftController {
  const navigate = useNavigate();
  const getDraftThreadByProjectId = useComposerDraftStore(
    (store) => store.getDraftThreadByProjectId,
  );
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const setProjectDraftThreadId = useComposerDraftStore((store) => store.setProjectDraftThreadId);
  const clearProjectDraftThreadId = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadId,
  );
  const [dialogState, setDialogState] = useState<PullRequestDialogState | null>(null);

  useEffect(() => {
    setDialogState(null);
  }, [threadId]);

  const open = useCallback(
    (reference?: string) => {
      if (!enabled) {
        return false;
      }
      setDialogState({
        initialReference: reference ?? null,
        key: Date.now(),
      });
      return true;
    },
    [enabled],
  );

  const close = useCallback(() => {
    setDialogState(null);
  }, []);

  const openOrReuseProjectDraftThread = useCallback(
    async (input: {
      branch: string;
      worktreePath: string | null;
      envMode: DraftThreadEnvMode;
      lastKnownPr?: Thread["lastKnownPr"];
    }) => {
      if (!project) {
        throw new Error("No active project is available for this pull request.");
      }
      const draftThreadContext = {
        branch: input.branch,
        worktreePath: input.worktreePath,
        envMode: input.envMode,
        ...(input.lastKnownPr !== undefined ? { lastKnownPr: input.lastKnownPr } : {}),
      };

      // Preserve the existing selection order: project draft, current draft, new draft.
      const storedDraftThread = getDraftThreadByProjectId(project.id);
      if (storedDraftThread) {
        setDraftThreadContext(storedDraftThread.threadId, draftThreadContext);
        setProjectDraftThreadId(project.id, storedDraftThread.threadId, draftThreadContext);
        if (storedDraftThread.threadId !== threadId) {
          await navigate({
            to: "/$threadId",
            params: { threadId: storedDraftThread.threadId },
          });
        }
        return;
      }

      const activeDraftThread = getDraftThread(threadId);
      if (
        !isServerThread &&
        activeDraftThread?.projectId === project.id &&
        activeDraftThread.entryPoint === "chat"
      ) {
        setDraftThreadContext(threadId, draftThreadContext);
        setProjectDraftThreadId(project.id, threadId, draftThreadContext);
        return;
      }

      clearProjectDraftThreadId(project.id);
      const nextThreadId = newThreadId();
      setProjectDraftThreadId(project.id, nextThreadId, {
        ...draftThreadContext,
        createdAt: new Date().toISOString(),
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
      });
      await navigate({
        to: "/$threadId",
        params: { threadId: nextThreadId },
      });
    },
    [
      clearProjectDraftThreadId,
      getDraftThread,
      getDraftThreadByProjectId,
      isServerThread,
      navigate,
      project,
      setDraftThreadContext,
      setProjectDraftThreadId,
      threadId,
    ],
  );

  const handlePreparedPullRequestThread = useCallback(
    async (input: {
      branch: string;
      worktreePath: string | null;
      pullRequest: NonNullable<Thread["lastKnownPr"]>;
    }) => {
      await openOrReuseProjectDraftThread({
        branch: input.branch,
        worktreePath: input.worktreePath,
        envMode: input.worktreePath ? "worktree" : "local",
        lastKnownPr: input.pullRequest,
      });
    },
    [openOrReuseProjectDraftThread],
  );

  const dialogProps = useMemo<PullRequestDraftDialogProps | null>(() => {
    if (!dialogState) {
      return null;
    }
    return {
      key: dialogState.key,
      open: true,
      cwd: project?.cwd ?? null,
      initialReference: dialogState.initialReference,
      onOpenChange: (nextOpen) => {
        if (!nextOpen) {
          close();
        }
      },
      onPrepared: handlePreparedPullRequestThread,
    };
  }, [close, dialogState, handlePreparedPullRequestThread, project?.cwd]);

  return { open, dialogProps };
}
