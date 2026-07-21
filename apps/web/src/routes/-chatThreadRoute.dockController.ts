import type { HighlightListItem, ProjectId, ThreadId, TurnId } from "@agent-group/contracts";
import { useNavigate } from "@tanstack/react-router";
import { startTransition, useCallback, useEffect, useMemo, useRef } from "react";

import { isTemporarySidechatThread } from "../agentGroupCapabilities";
import { useComposerDraftStore } from "../composerDraftStore";
import type { DiffRouteSearch } from "../diffRouteSearch";
import { stripDiffSearchParams } from "../diffRouteSearch";
import { basenameOfPath } from "../file-icons";
import { useDockPaneRuntimeActivation } from "../hooks/useDockPaneRuntimeActivation";
import { getSidechatCreator } from "../lib/sidechatCreatorRegistry";
import { discardTemporarySidechat } from "../lib/sidechatLifecycle";
import { SINGLE_CHAT_PANE_SCOPE_ID } from "../lib/chatPaneScope";
import { canComposerHandlePanelWidth } from "../lib/panelResize";
import { readNativeApi } from "../nativeApi";
import { selectRightDockState, useRightDockStore } from "../rightDockStore";
import {
  resolveActivePane,
  type RightDockPane,
  type RightDockPaneKind,
} from "../rightDockStore.logic";
import type { SplitDirection, SplitDropSide, SplitViewPanePanelState } from "../splitViewStore";
import { useSplitViewStore } from "../splitViewStore";
import { useStore } from "../store";
import type { Project, SidebarThreadSummary } from "../types";
import { toastManager } from "../components/ui/toast";
import {
  pullRequestDetailInputFromPane,
  pullRequestPaneTabLabel,
} from "../components/pullRequest/pullRequestDetail.logic";
import { usePullRequestPaneStateIcon } from "../components/pullRequest/usePullRequestPaneStateIcon";
import { resolveRoutePanelBootstrap } from "./-chatThreadRoute.logic";

type ThreadLabelSummary = Pick<SidebarThreadSummary, "id" | "title">;
type ActiveThreadSummary = Pick<SidebarThreadSummary, "updatedAt">;
type ActiveProject = Pick<Project, "id">;
type DockPanePatch = Partial<
  Pick<
    RightDockPane,
    | "diffTurnId"
    | "diffFilePath"
    | "filePath"
    | "threadId"
    | "pullRequestProjectId"
    | "pullRequestRepository"
    | "pullRequestNumber"
    | "pullRequestInitialTab"
  >
>;

export function useSingleChatDockController(input: {
  threadId: ThreadId;
  projectId: ProjectId | null;
  search: DiffRouteSearch;
  activeProject: ActiveProject | null | undefined;
  activeThreadSummary: ActiveThreadSummary | null;
  threadSummaries: readonly ThreadLabelSummary[];
  workspaceRoot: string | null;
}) {
  const navigate = useNavigate();
  const createSplitViewFromDrop = useSplitViewStore((store) => store.createFromDrop);
  const dockState = useRightDockStore(selectRightDockState(input.threadId));
  const openPane = useRightDockStore((store) => store.openPane);
  const ensurePane = useRightDockStore((store) => store.ensurePane);
  const toggleSingletonPane = useRightDockStore((store) => store.toggleSingletonPane);
  const closePane = useRightDockStore((store) => store.closePane);
  const setActivePane = useRightDockStore((store) => store.setActivePane);
  const setDockOpen = useRightDockStore((store) => store.setDockOpen);
  const updatePane = useRightDockStore((store) => store.updatePane);
  const lastAppliedRoutePanelSearchKeyRef = useRef<string | null>(null);
  const activePane = resolveActivePane(dockState);

  const closeDockPane = useCallback(
    (paneId: string) => {
      const pane = useRightDockStore
        .getState()
        .dockStateByThreadId[input.threadId]?.panes.find((candidate) => candidate.id === paneId);
      const sidechatThreadId = pane?.kind === "sidechat" ? pane.threadId : null;
      const sidechat = sidechatThreadId
        ? useStore.getState().sidebarThreadSummaryById[sidechatThreadId]
        : undefined;
      if (!sidechatThreadId || !sidechat || !isTemporarySidechatThread(sidechat)) {
        closePane(input.threadId, paneId);
        return;
      }

      const api = readNativeApi();
      if (!api) {
        toastManager.add({
          type: "warning",
          title: "Could not discard Side",
          description: "The Agent Group service is unavailable.",
        });
        return;
      }
      closePane(input.threadId, paneId);
      void discardTemporarySidechat({
        api,
        threadId: sidechatThreadId,
        clearDraft: useComposerDraftStore.getState().clearDraftThread,
        removeDeletedThreadFromClientState: useStore.getState().removeDeletedThreadFromClientState,
      }).catch((error: unknown) => {
        openPane(input.threadId, { kind: "sidechat", threadId: sidechatThreadId });
        toastManager.add({
          type: "error",
          title: "Could not discard Side",
          description: error instanceof Error ? error.message : "The sidechat was not deleted.",
        });
      });
    },
    [closePane, input.threadId, openPane],
  );

  const hasContextPane = dockState.panes.some((pane) => pane.kind === "context");
  useEffect(() => {
    if (hasContextPane) return;
    ensurePane(input.threadId, { paneId: `context:${input.threadId}`, kind: "context" });
  }, [ensurePane, hasContextPane, input.threadId]);

  const { activePaneRuntimeMode, requestActivePaneLive, requestImmediateHydration } =
    useDockPaneRuntimeActivation({ threadId: input.threadId, activePane });

  const chatPanelState = useMemo<SplitViewPanePanelState>(
    () => ({
      panel:
        activePane && (activePane.kind === "browser" || activePane.kind === "diff")
          ? activePane.kind
          : null,
      diffTurnId: activePane?.kind === "diff" ? activePane.diffTurnId : null,
      diffFilePath: activePane?.kind === "diff" ? activePane.diffFilePath : null,
      hasOpenedPanel: dockState.panes.length > 0,
      lastOpenPanel: "browser",
    }),
    [activePane, dockState.panes.length],
  );

  const toggleDiff = useCallback(() => {
    requestImmediateHydration("diff");
    toggleSingletonPane(input.threadId, { kind: "diff" });
  }, [input.threadId, requestImmediateHydration, toggleSingletonPane]);
  const toggleBrowser = useCallback(() => {
    requestImmediateHydration("browser");
    toggleSingletonPane(input.threadId, { kind: "browser" });
  }, [input.threadId, requestImmediateHydration, toggleSingletonPane]);
  const openBrowser = useCallback(() => {
    requestImmediateHydration("browser");
    openPane(input.threadId, { kind: "browser" });
  }, [input.threadId, openPane, requestImmediateHydration]);
  const openTurnDiff = useCallback(
    (turnId: TurnId, filePath?: string) => {
      requestImmediateHydration("diff");
      openPane(input.threadId, {
        kind: "diff",
        diffTurnId: turnId,
        diffFilePath: filePath ?? null,
      });
    },
    [input.threadId, openPane, requestImmediateHydration],
  );
  const openDockFile = useCallback(
    (filePath: string) => {
      requestImmediateHydration("file");
      openPane(input.threadId, { kind: "file", filePath });
    },
    [input.threadId, openPane, requestImmediateHydration],
  );

  const dropThread = useCallback(
    (payload: { threadId: ThreadId; direction: SplitDirection; side: SplitDropSide }) => {
      if (!input.projectId || payload.threadId === input.threadId) return;
      const splitViewId = createSplitViewFromDrop({
        sourceThreadId: input.threadId,
        ownerProjectId: input.projectId,
        droppedThreadId: payload.threadId,
        direction: payload.direction,
        side: payload.side,
      });
      startTransition(() => {
        void navigate({
          to: "/$threadId",
          params: { threadId: payload.threadId },
          replace: true,
          search: () => ({ splitViewId }),
        });
      });
    },
    [createSplitViewFromDrop, input.projectId, input.threadId, navigate],
  );

  useEffect(() => {
    const { nextAppliedSearchKey, panelPatch } = resolveRoutePanelBootstrap({
      scopeId: input.threadId,
      search: input.search,
      lastAppliedSearchKey: lastAppliedRoutePanelSearchKeyRef.current,
    });
    lastAppliedRoutePanelSearchKeyRef.current = nextAppliedSearchKey;
    if (!panelPatch) return;

    if (panelPatch.panel === "browser") {
      requestImmediateHydration("browser");
      openPane(input.threadId, { kind: "browser" });
    } else if (panelPatch.panel === "diff") {
      requestImmediateHydration("diff");
      openPane(input.threadId, {
        kind: "diff",
        diffTurnId: panelPatch.diffTurnId ?? null,
        diffFilePath: panelPatch.diffFilePath ?? null,
      });
    } else {
      setDockOpen(input.threadId, false);
    }
    void navigate({
      to: "/$threadId",
      params: { threadId: input.threadId },
      replace: true,
      search: (previous) => stripDiffSearchParams(previous),
    });
  }, [input.search, input.threadId, navigate, openPane, requestImmediateHydration, setDockOpen]);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") return;
    const unsubscribe = onMenuAction((action) => {
      if (action !== "toggle-browser") return;
      requestImmediateHydration("browser");
      toggleSingletonPane(input.threadId, { kind: "browser" });
    });
    return () => unsubscribe?.();
  }, [input.threadId, requestImmediateHydration, toggleSingletonPane]);

  useEffect(() => {
    const onOpenBrowserPanelRequest = window.desktopBridge?.browser.onBrowserUseOpenPanelRequest;
    if (typeof onOpenBrowserPanelRequest !== "function") return;
    const unsubscribe = onOpenBrowserPanelRequest(() => {
      requestImmediateHydration("browser");
      openPane(input.threadId, { kind: "browser" });
    });
    return () => unsubscribe?.();
  }, [input.threadId, openPane, requestImmediateHydration]);

  const excludedThreadIds = useMemo(() => new Set<ThreadId>([input.threadId]), [input.threadId]);
  const paneLabelOverrides = useMemo(() => {
    const hasSidechatPane = dockState.panes.some((pane) => pane.kind === "sidechat");
    const hasNamedFilePane = dockState.panes.some(
      (pane) => pane.kind === "file" && pane.filePath !== null,
    );
    const hasNumberedPullRequestPane = dockState.panes.some(
      (pane) => pane.kind === "pullRequest" && pane.pullRequestNumber !== null,
    );
    if (!hasSidechatPane && !hasNamedFilePane && !hasNumberedPullRequestPane) return undefined;

    const titleByThreadId = hasSidechatPane
      ? new Map(input.threadSummaries.map((summary) => [summary.id, summary.title]))
      : null;
    const overrides: Record<string, string | undefined> = {};
    for (const pane of dockState.panes) {
      if (pane.kind === "sidechat" && pane.threadId) {
        overrides[pane.id] = titleByThreadId?.get(pane.threadId) || "Side";
      } else if (pane.kind === "file" && pane.filePath) {
        overrides[pane.id] = basenameOfPath(pane.filePath);
      } else if (pane.kind === "pullRequest" && pane.pullRequestNumber !== null) {
        overrides[pane.id] = pullRequestPaneTabLabel(pane.pullRequestNumber);
      }
    }
    return overrides;
  }, [dockState.panes, input.threadSummaries]);

  const pullRequestPane = dockState.panes.find(
    (pane) => pane.kind === "pullRequest" && pullRequestDetailInputFromPane(pane) !== null,
  );
  const pullRequestPaneStateIcon = usePullRequestPaneStateIcon(
    pullRequestPane ? pullRequestDetailInputFromPane(pullRequestPane) : null,
  );
  const paneIconOverrides =
    pullRequestPane && pullRequestPaneStateIcon
      ? { [pullRequestPane.id]: pullRequestPaneStateIcon }
      : undefined;

  const shouldAcceptWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
      return canComposerHandlePanelWidth({
        nextWidth,
        paneScopeId: SINGLE_CHAT_PANE_SCOPE_ID,
        applyWidth: (width) => wrapper.style.setProperty("--sidebar-width", `${width}px`),
        resetWidth: () => {
          if (previousSidebarWidth.length > 0) {
            wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
          } else {
            wrapper.style.removeProperty("--sidebar-width");
          }
        },
      });
    },
    [],
  );

  const addPane = useCallback(
    (kind: RightDockPaneKind) => {
      requestImmediateHydration(kind);
      if (kind === "sidechat") {
        const createSidechat = getSidechatCreator(input.threadId);
        if (!createSidechat) {
          toastManager.add({
            type: "warning",
            title: "Side is unavailable",
            description: "Open a server-backed main thread before starting Side.",
          });
          return;
        }
        void createSidechat().catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not start Side",
            description:
              error instanceof Error ? error.message : "An error occurred while creating Side.",
          });
        });
        return;
      }
      openPane(input.threadId, { kind });
    },
    [input.threadId, openPane, requestImmediateHydration],
  );
  const openHighlights = useCallback(() => addPane("highlights"), [addPane]);
  const jumpToHighlight = useCallback(
    (item: HighlightListItem) => {
      openPane(item.session.id, { kind: "highlights" });
      void navigate({
        to: "/$threadId",
        params: { threadId: item.session.id },
        search:
          item.kind === "highlight"
            ? { highlightId: item.marker.id }
            : { messageThreadId: item.session.id, messageId: item.message.id },
      });
    },
    [navigate, openPane],
  );
  const selectPane = useCallback(
    (paneId: string) => {
      requestImmediateHydration(dockState.panes.find((pane) => pane.id === paneId)?.kind);
      setActivePane(input.threadId, paneId);
    },
    [dockState.panes, input.threadId, requestImmediateHydration, setActivePane],
  );
  const closeRegularPane = useCallback(
    (paneId: string) => closePane(input.threadId, paneId),
    [closePane, input.threadId],
  );
  const updateDockPane = useCallback(
    (paneId: string, patch: DockPanePatch) => updatePane(input.threadId, paneId, patch),
    [input.threadId, updatePane],
  );
  const setOpen = useCallback(
    (open: boolean) => setDockOpen(input.threadId, open),
    [input.threadId, setDockOpen],
  );
  const promoteSidechat = useCallback(
    async (paneId: string, threadId: ThreadId) => {
      closePane(input.threadId, paneId);
      await navigate({ to: "/$threadId", params: { threadId } });
    },
    [closePane, input.threadId, navigate],
  );

  return {
    model: {
      dockState,
      activePane,
      activePaneRuntimeMode,
      chatPanelState,
      excludedThreadIds,
      paneLabelOverrides,
      paneIconOverrides,
    },
    chat: { toggleDiff, toggleBrowser, openBrowser, openTurnDiff, openHighlights },
    dock: {
      shouldAcceptWidth,
      addPane,
      selectPane,
      closePane: closeDockPane,
      setOpen,
    },
    split: { dropThread },
    pane: {
      threadId: input.threadId,
      projectId: input.projectId,
      activeProject: input.activeProject,
      activeThreadSummary: input.activeThreadSummary,
      workspaceRoot: input.workspaceRoot,
      dockOpen: dockState.open,
      close: closeRegularPane,
      closeManaged: closeDockPane,
      update: updateDockPane,
      requestLive: requestActivePaneLive,
      jumpToHighlight,
      promoteSidechat,
    },
    openDockFile,
  };
}

export type SingleChatDockController = ReturnType<typeof useSingleChatDockController>;
