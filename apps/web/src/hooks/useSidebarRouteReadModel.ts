// FILE: useSidebarRouteReadModel.ts
// Purpose: Read the sidebar's route, surface, settings, and active split-view state.
// Layer: Web sidebar read model

import { ThreadId } from "@agent-group/contracts";
import { useLocation, useParams, useSearch } from "@tanstack/react-router";
import { normalizeSettingsSection } from "../settingsNavigation";
import { selectSplitView, useSplitViewStore } from "../splitViewStore";
import { useDiffRouteSearch } from "./useDiffRouteSearch";

export function useSidebarRouteReadModel() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const isOnSettings = useLocation({
    select: (location) => location.pathname === "/settings",
  });
  const threadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const workspaceId = useParams({
    strict: false,
    select: (params) => (typeof params.workspaceId === "string" ? params.workspaceId : null),
  });
  const search = useDiffRouteSearch();
  const settingsSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const activeSplitView = useSplitViewStore(selectSplitView(search.splitViewId ?? null));
  const splitViewsById = useSplitViewStore((store) => store.splitViewsById);

  return {
    route: {
      pathname,
      threadId,
      workspaceId,
      search,
      activeSplitView,
      splitViewsById,
    },
    surface: {
      isOnSettings,
      isOnWorkspace: pathname.startsWith("/workspace"),
      isOnStudioRoute: pathname.startsWith("/studio"),
      isOnKanban: pathname.startsWith("/kanban"),
      isOnAutomations: pathname.startsWith("/automations"),
      isOnPullRequests: pathname.startsWith("/pull-requests"),
    },
    settings: {
      activeSection: normalizeSettingsSection(settingsSearch.section),
    },
  };
}

export type SidebarRouteReadModel = ReturnType<typeof useSidebarRouteReadModel>;
