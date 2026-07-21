// FILE: useChatSessionWorkspaceOwner.ts
// Purpose: Own the active chat session, workspace, panel, and provider read models.
// Layer: Web chat session/workspace owner

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { GIT_WORKING_TREE_DIFF_LIVE_REFETCH_INTERVAL_MS } from "../lib/gitReactQuery";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { useProjectInstructionsStore } from "../projectInstructionsStore";
import { useStore } from "../store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";
import { useChatPanelRouteController } from "./useChatPanelRouteController";
import { useChatTerminalController } from "./useChatTerminalController";
import { useChatWorkspaceReadModel } from "./useChatWorkspaceReadModel";
import { useComposerProviderModelState } from "./useComposerProviderModelState";
import { usePullRequestDraftController } from "./usePullRequestDraftController";
import { useThreadProviderRuntimeModel } from "./useThreadProviderRuntimeModel";

type Navigate = ReturnType<typeof useNavigate>;
type PanelRouteInput = Parameters<typeof useChatPanelRouteController>[0];
type TerminalInput = Parameters<typeof useChatTerminalController>[0];
type WorkspaceInput = Parameters<typeof useChatWorkspaceReadModel>[0];
type ProviderModelInput = Parameters<typeof useComposerProviderModelState>[0];
type RuntimeInput = Parameters<typeof useThreadProviderRuntimeModel>[0];

export interface ChatSessionWorkspaceOwnerInput {
  readonly route: {
    readonly threadId: PanelRouteInput["threadId"];
    readonly splitViewId: TerminalInput["splitViewId"];
    readonly panel: PanelRouteInput["routePanel"];
    readonly navigate: Navigate;
  };
  readonly thread: {
    readonly active: RuntimeInput["thread"];
    readonly draft: WorkspaceInput["draftThread"];
    readonly isLocalDraft: boolean;
    readonly isServer: WorkspaceInput["isServerThread"];
  };
  readonly composer: {
    readonly draft: ProviderModelInput["draft"];
    readonly prompt: ProviderModelInput["prompt"];
    readonly modelPickerOpen: ProviderModelInput["pickerOpen"];
  };
  readonly presentation: {
    readonly focusedPane: TerminalInput["focusedPane"];
    readonly dismissedRateLimitBannerKey: RuntimeInput["dismissedRateLimitBannerKey"];
  };
  readonly panels: {
    readonly external: PanelRouteInput["externalPanel"];
    readonly onToggleDiff?: PanelRouteInput["onToggleDiffPanel"];
    readonly onToggleBrowser?: PanelRouteInput["onToggleBrowserPanel"];
    readonly onOpenBrowserUrl?: PanelRouteInput["onOpenBrowserUrl"];
  };
  readonly provider: {
    readonly settings: ProviderModelInput["settings"];
  };
  readonly actions: {
    readonly setComposerHighlightedItemId: (itemId: string | null) => void;
  };
}

export function useChatSessionWorkspaceOwner(input: ChatSessionWorkspaceOwnerInput) {
  const { active: activeThread, draft: draftThread, isLocalDraft, isServer } = input.thread;
  const { threadId } = input.route;
  const runtimeMode =
    input.composer.draft.runtimeMode ?? activeThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const interactionMode =
    input.composer.draft.interactionMode ??
    activeThread?.interactionMode ??
    DEFAULT_INTERACTION_MODE;

  const providerRuntime = useThreadProviderRuntimeModel({
    thread: activeThread,
    dismissedRateLimitBannerKey: input.presentation.dismissedRateLimitBannerKey,
  });
  const workspaceModel = useChatWorkspaceReadModel({
    thread: activeThread,
    draftThread,
    isServerThread: isServer,
  });
  const { project, container, environment, git, terminalRuntimeEnv } = workspaceModel;
  const terminal = useChatTerminalController({
    focusedPane: input.presentation.focusedPane,
    hasProject: Boolean(project.value),
    isServerThread: isServer,
    splitViewId: input.route.splitViewId,
    thread: activeThread,
    threadId,
  });

  const automationProjects = useStore((state) => state.projects);
  const automationThreads = useStore((state) => state.threads);
  const instructions = useProjectInstructionsStore((state) =>
    project.id ? (state.instructionsByProjectId[project.id] ?? "") : "",
  );
  const setInstructions = useProjectInstructionsStore((state) => state.setInstructions);

  const panelRoutes = useChatPanelRouteController({
    threadId,
    routePanel: input.route.panel,
    externalPanel: input.panels.external,
    diffEnvironmentPending: environment.diffPending,
    navigate: input.route.navigate,
    onToggleDiffPanel: input.panels.onToggleDiff,
    onToggleBrowserPanel: input.panels.onToggleBrowser,
    onOpenBrowserUrl: input.panels.onOpenBrowserUrl,
  });
  const repoDiffBadgeRefreshIntervalMs =
    input.presentation.focusedPane &&
    providerRuntime.live &&
    !environment.diffPending &&
    !panelRoutes.resolvedDiffOpen
      ? GIT_WORKING_TREE_DIFF_LIVE_REFETCH_INTERVAL_MS
      : false;

  const pullRequest = usePullRequestDraftController({
    threadId,
    project: project.value,
    isServerThread: isServer,
    enabled: isLocalDraft,
  });
  const { setComposerHighlightedItemId } = input.actions;
  const openPullRequestDialog = useCallback(
    (reference?: string) => {
      if (pullRequest.open(reference)) {
        setComposerHighlightedItemId(null);
      }
    },
    [pullRequest.open, setComposerHighlightedItemId],
  );

  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const providerModel = useComposerProviderModelState({
    threadId,
    prompt: input.composer.prompt,
    draft: input.composer.draft,
    threadModelSelection: activeThread?.modelSelection ?? null,
    projectModelSelection: project.value?.defaultModelSelection ?? null,
    sessionProvider: activeThread?.session?.provider ?? null,
    threadStarted: Boolean(
      activeThread &&
      (activeThread.latestTurn !== null ||
        activeThread.messages.length > 0 ||
        activeThread.session !== null),
    ),
    threadWorktreePath: environment.worktreePath,
    projectCwd: project.value?.cwd ?? null,
    serverCwd: serverConfigQuery.data?.cwd ?? null,
    pickerOpen: input.composer.modelPickerOpen,
    settings: input.provider.settings,
  });

  return {
    runtime: {
      runtimeMode,
      interactionMode,
      ...providerRuntime,
    },
    workspace: {
      container,
      environment,
      git,
      terminalRuntimeEnv,
      gitCwd: git.cwd,
      isChatProject: container.isLanding,
      repoDiffBadgeRefreshIntervalMs,
    },
    terminal,
    panels: {
      ...panelRoutes,
      pullRequestDialogProps: pullRequest.dialogProps,
      openPullRequestDialog,
    },
    provider: {
      ...providerModel,
      serverConfigQuery,
    },
    project: {
      ...project,
      canCheckoutPullRequestIntoThread: isLocalDraft,
      automationProjects,
      automationThreads,
      instructions,
      setInstructions,
    },
  };
}
