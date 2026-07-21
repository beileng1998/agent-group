// FILE: AgentGroupShellNavigation.tsx
// Purpose: Owns shell-level session navigation shared by the sidebar and mobile dock.
// Layer: Shared web shell controller

import type { ThreadId } from "@agent-group/contracts";
import { useNavigate } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { useStore } from "~/store";

import { selectAgentGroupProjects, selectAgentGroupSessions } from "./AgentGroupSidebar.logic";
import { AgentGroupSessionPalette } from "./AgentGroupSessionPalette";
import { useSidebar } from "./ui/sidebar";

type AgentGroupShellNavigationContextValue = {
  readonly groupsOpen: boolean;
  readonly searchOpen: boolean;
  readonly openGroups: () => void;
  readonly openSearch: () => void;
  readonly openSession: (threadId: ThreadId) => void;
};

const AgentGroupShellNavigationContext =
  createContext<AgentGroupShellNavigationContextValue | null>(null);

export function useAgentGroupShellNavigation(): AgentGroupShellNavigationContextValue {
  const value = useContext(AgentGroupShellNavigationContext);
  if (!value) {
    throw new Error(
      "useAgentGroupShellNavigation must be used within AgentGroupShellNavigationProvider.",
    );
  }
  return value;
}

function AgentGroupSessionPaletteHost(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenSession: (threadId: ThreadId) => void;
}) {
  const projects = useStore((state) => state.projects);
  const threadSummaries = useStore((state) => state.sidebarThreadSummaryById);
  const groups = useMemo(() => selectAgentGroupProjects(projects), [projects]);
  const sessions = useMemo(() => selectAgentGroupSessions(threadSummaries), [threadSummaries]);

  return (
    <AgentGroupSessionPalette
      groups={groups}
      open={props.open}
      sessions={sessions}
      onOpenChange={props.onOpenChange}
      onOpenSession={props.onOpenSession}
    />
  );
}

export function AgentGroupShellNavigationProvider(props: { readonly children: ReactNode }) {
  const navigate = useNavigate();
  const { openMobile: groupsOpen, setOpenMobile } = useSidebar();
  const [searchOpen, setSearchOpen] = useState(false);

  const openSession = useCallback(
    (threadId: ThreadId) => {
      setSearchOpen(false);
      setOpenMobile(false);
      void navigate({ to: "/$threadId", params: { threadId } });
    },
    [navigate, setOpenMobile],
  );

  const openGroups = useCallback(() => {
    setSearchOpen(false);
    setOpenMobile(true);
  }, [setOpenMobile]);

  const openSearch = useCallback(() => {
    setOpenMobile(false);
    setSearchOpen(true);
  }, [setOpenMobile]);

  const value = useMemo<AgentGroupShellNavigationContextValue>(
    () => ({
      groupsOpen,
      searchOpen,
      openGroups,
      openSearch,
      openSession,
    }),
    [groupsOpen, openGroups, openSearch, openSession, searchOpen],
  );

  return (
    <AgentGroupShellNavigationContext.Provider value={value}>
      {props.children}
      {searchOpen ? (
        <AgentGroupSessionPaletteHost
          open
          onOpenChange={setSearchOpen}
          onOpenSession={openSession}
        />
      ) : null}
    </AgentGroupShellNavigationContext.Provider>
  );
}
