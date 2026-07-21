// FILE: MobileDock.tsx
// Purpose: Thumb-reachable mobile navigation without duplicating sidebar business UI.
// Layer: Mobile-only web shell presentation

import { useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { isElectron } from "~/env";
import { ChatBubbleIcon, FoldersIcon, SearchIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { useStore } from "~/store";

import { useAgentGroupShellNavigation } from "./AgentGroupShellNavigation";
import { selectAgentGroupSessions } from "./AgentGroupSidebar.logic";
import {
  resolveCurrentAgentGroupSession,
  sessionIdFromPathname,
} from "./AgentGroupShellNavigation.logic";
import { useSidebar } from "./ui/sidebar";

const ITEM_CLASS_NAME =
  "flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[length:var(--app-font-size-ui-xs,10px)] font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40";

export function MobileDock() {
  const { isMobile } = useSidebar();

  if (isElectron || !isMobile) return null;

  return <MobileDockContent />;
}

function MobileDockContent() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const threadSummaries = useStore((state) => state.sidebarThreadSummaryById);
  const navigation = useAgentGroupShellNavigation();
  const [rememberedSessionId, setRememberedSessionId] = useState<string | null>(null);
  const sessions = useMemo(() => selectAgentGroupSessions(threadSummaries), [threadSummaries]);
  const routeSessionId = sessionIdFromPathname(pathname);
  const currentSession = useMemo(
    () => resolveCurrentAgentGroupSession({ pathname, rememberedSessionId, sessions }),
    [pathname, rememberedSessionId, sessions],
  );
  const isCurrentSessionActive = currentSession?.id === routeSessionId;

  useEffect(() => {
    if (routeSessionId && sessions.some((session) => session.id === routeSessionId)) {
      setRememberedSessionId(routeSessionId);
    }
  }, [routeSessionId, sessions]);

  return (
    <nav
      aria-label="Mobile navigation"
      className="app-sidebar-surface relative z-30 mt-auto shrink-0 border-t border-sidebar-border px-3 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] md:hidden"
    >
      <div className="mx-auto grid max-w-sm grid-cols-3 gap-1">
        <button
          type="button"
          aria-expanded={navigation.groupsOpen}
          className={cn(
            ITEM_CLASS_NAME,
            navigation.groupsOpen
              ? "bg-[var(--sidebar-accent-active)] text-foreground"
              : "hover:bg-[var(--sidebar-accent)] hover:text-foreground",
          )}
          onClick={navigation.openGroups}
        >
          <FoldersIcon className="size-5" />
          <span>Groups</span>
        </button>

        <button
          type="button"
          aria-current={isCurrentSessionActive ? "page" : undefined}
          className={cn(
            ITEM_CLASS_NAME,
            isCurrentSessionActive
              ? "bg-[var(--sidebar-accent-active)] text-foreground"
              : "hover:bg-[var(--sidebar-accent)] hover:text-foreground",
          )}
          disabled={!currentSession}
          title={currentSession?.title ?? "No current session"}
          onClick={() => {
            if (currentSession) navigation.openSession(currentSession.id);
          }}
        >
          <ChatBubbleIcon className="size-5" />
          <span>Current</span>
        </button>

        <button
          type="button"
          aria-expanded={navigation.searchOpen}
          className={cn(
            ITEM_CLASS_NAME,
            navigation.searchOpen
              ? "bg-[var(--sidebar-accent-active)] text-foreground"
              : "hover:bg-[var(--sidebar-accent)] hover:text-foreground",
          )}
          onClick={navigation.openSearch}
        >
          <SearchIcon className="size-5" />
          <span>Search</span>
        </button>
      </div>
    </nav>
  );
}
