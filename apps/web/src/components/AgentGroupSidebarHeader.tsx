import { useEffect } from "react";

import { PlusIcon, SearchIcon, SettingsIcon } from "~/lib/icons";
import { isMacPlatform } from "~/lib/utils";
import { isElectron } from "~/env";

import { agentGroupSidebarHeaderClassName } from "./AgentGroupSidebarHeader.logic";
import { Button } from "./ui/button";

type AgentGroupSidebarHeaderProps =
  | { readonly mode: "settings" }
  | {
      readonly mode: "groups";
      readonly addGroupOpen: boolean;
      readonly searchOpen: boolean;
      readonly onOpenSearch: () => void;
      readonly onToggleAddGroup: () => void;
    };

export function AgentGroupSidebarHeader(props: AgentGroupSidebarHeaderProps) {
  const isMacDesktop = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);
  const onOpenSearch = props.mode === "groups" ? props.onOpenSearch : null;

  useEffect(() => {
    if (!onOpenSearch) return;
    const openGlobalSearch = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (!event.metaKey && !event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.key.toLocaleLowerCase() !== "k"
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onOpenSearch();
    };
    window.addEventListener("keydown", openGlobalSearch, { capture: true });
    return () => window.removeEventListener("keydown", openGlobalSearch, { capture: true });
  }, [onOpenSearch]);

  return (
    <div
      data-slot="agent-group-sidebar-header"
      className={agentGroupSidebarHeaderClassName({ isElectron, isMacDesktop })}
    >
      {props.mode === "settings" ? (
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground/85">
          <SettingsIcon className="size-3.5 text-muted-foreground" />
          <span>Settings</span>
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              aria-label="Search groups and sessions"
              aria-haspopup="dialog"
              aria-expanded={props.searchOpen}
              className="relative flex h-7 w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-foreground/2 px-2.5 pe-9 text-start text-[length:var(--app-font-size-ui-sm,11px)] text-muted-foreground outline-none hover:bg-foreground/4 hover:text-foreground focus-visible:border-foreground/30 focus-visible:ring-1 focus-visible:ring-ring/50 dark:bg-foreground/2"
              onClick={props.onOpenSearch}
            >
              <SearchIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
              <span className="min-w-0 flex-1 truncate">Search groups &amp; sessions</span>
              <kbd className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 rounded border border-border/70 bg-background/55 px-1 py-0.5 font-sans text-[9px] leading-none text-muted-foreground/65">
                {isMacDesktop ? "⌘K" : "Ctrl K"}
              </kbd>
            </button>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="New group"
            aria-expanded={props.addGroupOpen}
            title="New group"
            onClick={props.onToggleAddGroup}
          >
            <PlusIcon className="size-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}
