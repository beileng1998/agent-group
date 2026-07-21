// FILE: AgentGroupRecentViewShortcuts.tsx
// Purpose: Restore the bounded recent-view switcher in the Agent Group shell.
// Layer: Shell keyboard navigation

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useFocusedChatContext } from "~/focusedChatContext";
import { useRecentViewSwitcher } from "~/hooks/useRecentViewSwitcher";
import { resolveShortcutCommand } from "~/keybindings";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { useStore } from "~/store";
import { RecentViewSwitcher } from "./RecentViewSwitcher";

function isCommitKey(event: KeyboardEvent): boolean {
  return event.key === "Enter" || event.key === " " || event.key === "Spacebar";
}

export function AgentGroupRecentViewShortcuts() {
  const projects = useStore((state) => state.projects);
  const { activeDraftThread, focusedThreadId } = useFocusedChatContext();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const {
    cancelRecentSwitcher,
    commitRecentSwitcherSelection,
    openOrAdvanceRecentSwitcher,
    recentSwitcherState,
    recentViewEntries,
  } = useRecentViewSwitcher({
    activeContextThreadId: focusedThreadId,
    activeDraftThread,
    projects,
  });

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      if (recentSwitcherState && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelRecentSwitcher();
        return;
      }

      if (recentSwitcherState && isCommitKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        commitRecentSwitcherSelection();
        return;
      }

      const command = resolveShortcutCommand(event, serverConfigQuery.data?.keybindings ?? [], {
        context: { terminalFocus: isTerminalFocused() },
      });
      if (command !== "view.recent.next" && command !== "view.recent.previous") return;

      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      openOrAdvanceRecentSwitcher(command === "view.recent.next" ? "next" : "previous");
    };

    window.addEventListener("keydown", onWindowKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onWindowKeyDown, { capture: true });
  }, [
    cancelRecentSwitcher,
    commitRecentSwitcherSelection,
    openOrAdvanceRecentSwitcher,
    recentSwitcherState,
    serverConfigQuery.data?.keybindings,
  ]);

  return recentSwitcherState ? (
    <RecentViewSwitcher
      entries={recentViewEntries}
      selectedIndex={recentSwitcherState.selectedIndex}
    />
  ) : null;
}
