import type { ProjectId, ThreadId } from "@agent-group/contracts";
import { useMemo } from "react";

import { useAppSettings } from "../appSettings";
import { useComposerDraftStore } from "../composerDraftStore";
import { useStore } from "../store";
import {
  createProjectSelector,
  createSidebarThreadSummariesSelector,
  createThreadWorkspaceMetadataSelector,
} from "../storeSelectors";
import { resolveFilePreviewWorkspaceRoot } from "./-chatThreadRoute.logic";

export function useSingleChatReadModel(input: { threadId: ThreadId; projectId: ProjectId | null }) {
  const activeProject = useStore(
    useMemo(() => createProjectSelector(input.projectId), [input.projectId]),
  );
  const activeThreadSummary = useStore(
    (store) => store.sidebarThreadSummaryById[input.threadId] ?? null,
  );
  const threadWorkspaceMetadata = useStore(
    useMemo(() => createThreadWorkspaceMetadataSelector(input.threadId), [input.threadId]),
  );
  const draftThread = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[input.threadId] ?? null,
  );
  const projects = useStore((store) => store.projects);
  const threadSummaries = useStore(useMemo(() => createSidebarThreadSummariesSelector(), []));
  const { settings: appSettings } = useAppSettings();

  const workspaceRoot = resolveFilePreviewWorkspaceRoot({
    projectCwd: activeProject?.cwd ?? null,
    threadEnvMode: threadWorkspaceMetadata.envMode ?? draftThread?.envMode ?? null,
    threadWorktreePath: threadWorkspaceMetadata.worktreePath ?? draftThread?.worktreePath ?? null,
  });

  return {
    activeProject,
    activeThreadSummary,
    workspaceRoot,
    projects,
    threadSummaries,
    appSettings,
  };
}

export type SingleChatReadModel = ReturnType<typeof useSingleChatReadModel>;
