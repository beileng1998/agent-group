import { useMemo, useState } from "react";

import { SearchIcon } from "~/lib/icons";
import { formatRelativeTime } from "~/lib/relativeTime";
import { createAllThreadsSelector } from "~/storeSelectors";
import { useStore } from "~/store";
import type { Project, SidebarThreadSummary } from "~/types";

import {
  buildAgentGroupSessionPaletteModel,
  type AgentGroupSessionPaletteItem,
  type AgentGroupSessionPaletteMatch,
} from "./AgentGroupSessionPalette.logic";
import { ProviderIcon } from "./ProviderIcon";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
} from "./ui/command";

interface AgentGroupSessionPaletteProps {
  readonly groups: readonly Project[];
  readonly open: boolean;
  readonly sessions: readonly SidebarThreadSummary[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenSession: (threadId: SidebarThreadSummary["id"]) => void | Promise<void>;
}

function sessionTimestamp(item: AgentGroupSessionPaletteItem): string {
  return item.thread.lastVisitedAt ?? item.thread.updatedAt ?? item.thread.createdAt;
}

function matchLabel(match: AgentGroupSessionPaletteMatch | undefined): string | null {
  if (!match) return null;
  if (match.matchKind === "message") {
    return match.messageMatchCount > 1
      ? `${match.messageMatchCount} message matches`
      : "Message match";
  }
  if (match.matchKind === "project") return "Group match";
  return null;
}

function SessionPaletteRow(props: {
  readonly item: AgentGroupSessionPaletteItem;
  readonly match?: AgentGroupSessionPaletteMatch;
  readonly onOpen: (item: AgentGroupSessionPaletteItem) => void;
}) {
  const { item } = props;
  const provider =
    item.thread.session?.status === "running" || item.thread.session?.status === "connecting"
      ? item.thread.session.provider
      : item.thread.modelSelection.provider;
  const secondaryLabel = matchLabel(props.match);

  return (
    <CommandItem
      value={`session:${item.thread.id}`}
      className="cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => props.onOpen(item)}
    >
      <div className="flex size-5 shrink-0 items-center justify-center pt-0.5">
        <ProviderIcon provider={provider} className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[length:var(--app-font-size-ui,12px)] text-foreground">
            {item.thread.title || "New session"}
          </span>
          {item.status ? (
            <span
              className={`flex shrink-0 items-center gap-1 text-[length:var(--app-font-size-ui-meta,10px)] ${item.status.colorClass}`}
            >
              <span
                className={`size-1.5 rounded-full ${item.status.dotClass} ${item.status.pulse ? "animate-pulse" : ""}`}
              />
              {item.status.label}
            </span>
          ) : null}
          <span className="w-10 shrink-0 text-right text-[length:var(--app-font-size-ui-timestamp,10px)] text-muted-foreground/70">
            {formatRelativeTime(sessionTimestamp(item))}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[length:var(--app-font-size-ui-meta,10px)] text-muted-foreground/72">
          <span className="min-w-0 flex-1 truncate">{item.path}</span>
          {secondaryLabel ? <span className="shrink-0">{secondaryLabel}</span> : null}
        </div>
        {props.match?.snippet ? (
          <div className="mt-0.5 line-clamp-1 text-[length:var(--app-font-size-ui-meta,10px)] text-muted-foreground/80">
            {props.match.snippet}
          </div>
        ) : null}
      </div>
    </CommandItem>
  );
}

function SessionPaletteSection(props: {
  readonly items: readonly AgentGroupSessionPaletteItem[];
  readonly label: string;
  readonly onOpen: (item: AgentGroupSessionPaletteItem) => void;
}) {
  if (props.items.length === 0) return null;
  return (
    <CommandGroup>
      <CommandGroupLabel className="py-1.5 pl-3">{props.label}</CommandGroupLabel>
      {props.items.map((item) => (
        <SessionPaletteRow key={item.thread.id} item={item} onOpen={props.onOpen} />
      ))}
    </CommandGroup>
  );
}

export function AgentGroupSessionPalette(props: AgentGroupSessionPaletteProps) {
  const selectAllThreads = useMemo(() => createAllThreadsSelector(), []);
  const threads = useStore(selectAllThreads);
  const [query, setQuery] = useState("");

  const messagesBySessionId = useMemo(
    () =>
      new Map(
        threads.map((thread) => [
          thread.id,
          thread.messages.map((message) => ({ text: message.text })),
        ]),
      ),
    [threads],
  );
  const model = useMemo(
    () =>
      buildAgentGroupSessionPaletteModel({
        groups: props.groups,
        messagesBySessionId,
        query,
        sessions: props.sessions,
      }),
    [messagesBySessionId, props.groups, props.sessions, query],
  );
  const isSearching = query.trim().length > 0;
  const hasDefaultItems =
    model.attention.length > 0 || model.running.length > 0 || model.recent.length > 0;

  const openSession = (item: AgentGroupSessionPaletteItem) => {
    props.onOpenChange(false);
    void props.onOpenSession(item.thread.id);
  };

  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CommandDialogPopup className="max-w-2xl">
        <Command autoHighlight="always" mode="none">
          <CommandPanel className="overflow-hidden">
            <CommandInput
              aria-label="Search sessions and messages"
              placeholder="Search sessions and messages"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              startAddon={<SearchIcon className="text-muted-foreground" />}
            />
            <CommandList className="max-h-[min(28rem,65vh)] not-empty:px-1.5 not-empty:pb-1.5">
              {isSearching ? (
                model.searchResults.length > 0 ? (
                  <CommandGroup>
                    <CommandGroupLabel className="py-1.5 pl-3">Sessions</CommandGroupLabel>
                    {model.searchResults.map((match) => (
                      <SessionPaletteRow
                        key={match.thread.id}
                        item={match}
                        match={match}
                        onOpen={openSession}
                      />
                    ))}
                  </CommandGroup>
                ) : (
                  <CommandEmpty className="py-10">No matching sessions or messages.</CommandEmpty>
                )
              ) : hasDefaultItems ? (
                <>
                  <SessionPaletteSection
                    label="Needs attention"
                    items={model.attention}
                    onOpen={openSession}
                  />
                  {model.attention.length > 0 && model.running.length > 0 ? (
                    <CommandSeparator />
                  ) : null}
                  <SessionPaletteSection
                    label="Running"
                    items={model.running}
                    onOpen={openSession}
                  />
                  {(model.attention.length > 0 || model.running.length > 0) &&
                  model.recent.length > 0 ? (
                    <CommandSeparator />
                  ) : null}
                  <SessionPaletteSection
                    label="Recently visited"
                    items={model.recent}
                    onOpen={openSession}
                  />
                </>
              ) : (
                <CommandEmpty className="py-10">No sessions yet.</CommandEmpty>
              )}
            </CommandList>
          </CommandPanel>
          <CommandFooter>
            <span>Jump to a session that needs you.</span>
            <span>↑↓ to navigate · Enter to open</span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
