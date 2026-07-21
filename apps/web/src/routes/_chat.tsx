import { Outlet, createFileRoute, useLocation } from "@tanstack/react-router";
import { lazy, Suspense, useRef, useState } from "react";

import AgentGroupSidebar from "~/components/AgentGroupSidebar";
import { AgentGroupRecentViewShortcuts } from "~/components/AgentGroupRecentViewShortcuts";
import { AgentGroupShellNavigationProvider } from "~/components/AgentGroupShellNavigation";
import { MobileDock } from "~/components/MobileDock";
import { useGroupSettingsStore } from "~/groupSettingsStore";
import {
  Sidebar,
  SidebarInstanceProvider,
  SidebarProvider,
  SidebarRail,
} from "~/components/ui/sidebar";
import type { SidebarResizableOptions } from "~/components/ui/sidebar";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "agent_group_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

const THREAD_SIDEBAR_RESIZABLE: SidebarResizableOptions = {
  minWidth: THREAD_SIDEBAR_MIN_WIDTH,
  shouldAcceptWidth: ({ nextWidth, wrapper }) =>
    wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
  storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
};

const SIDEBAR_GAP_CLASS =
  "overflow-hidden before:absolute before:inset-0 before:bg-[radial-gradient(90%_75%_at_0%_0%,rgba(255,255,255,0.06),transparent_58%),linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.008))] dark:before:bg-[radial-gradient(90%_75%_at_0%_0%,rgba(255,255,255,0.04),transparent_58%),linear-gradient(180deg,rgba(255,255,255,0.018),rgba(255,255,255,0.006))]";

const AgentGroupSettingsSheet = lazy(() => import("~/components/AgentGroupSettingsSheet"));

function AgentGroupSettingsSheetHost() {
  const groupId = useGroupSettingsStore((state) => state.groupId);
  const hasOpened = useRef(false);
  if (groupId) hasOpened.current = true;
  if (!hasOpened.current) return null;
  return (
    <Suspense fallback={null}>
      <AgentGroupSettingsSheet />
    </Suspense>
  );
}

function ChatRouteLayout() {
  const isEditorView = useLocation({
    select: (location) => (location.search as { view?: unknown }).view === "editor",
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const resolvedSidebarOpen = isEditorView ? false : sidebarOpen;

  return (
    <SidebarProvider
      defaultOpen
      open={resolvedSidebarOpen}
      onOpenChange={setSidebarOpen}
      className="bg-[var(--app-shell-background)]"
      data-sidebar-side="left"
    >
      <AgentGroupShellNavigationProvider>
        <Sidebar
          side="left"
          collapsible="offcanvas"
          className="text-foreground"
          gapClassName={SIDEBAR_GAP_CLASS}
          innerClassName="app-sidebar-surface"
          transparentSurface
          resizable={THREAD_SIDEBAR_RESIZABLE}
        >
          <AgentGroupSidebar />
        </Sidebar>
        <AgentGroupSettingsSheetHost />
        <AgentGroupRecentViewShortcuts />
        <div className="chat-content-card-backing relative flex h-svh min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          {isEditorView ? null : (
            <SidebarInstanceProvider side="left" resizable={THREAD_SIDEBAR_RESIZABLE}>
              <SidebarRail placement="content-seam" />
            </SidebarInstanceProvider>
          )}
          <Outlet />
          <MobileDock />
        </div>
      </AgentGroupShellNavigationProvider>
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_chat")({
  component: ChatRouteLayout,
});
