import {
  HIGHLIGHTS_SEARCH_MAX_CHARS,
  type HighlightListItem,
  type HighlightItemKind,
  type HighlightsListInput,
  type ProjectId,
  type ThreadMarkerColor,
} from "@agent-group/contracts";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { SearchInput } from "~/components/ui/search-input";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import { buildHighlightSynthesisMessage } from "~/lib/highlightSynthesis";
import { ChevronRightIcon, RefreshCwIcon, SparklesIcon } from "~/lib/icons";
import { cn, newCommandId, newMessageId, newThreadId } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import {
  dispatchPinnedMessageDoneSet,
  dispatchPinnedMessageLabelSet,
  dispatchPinnedMessageRemove,
} from "~/pinnedMessages";
import { useStore } from "~/store";
import { dispatchThreadMarkerNoteSet, dispatchThreadMarkerRemove } from "~/threadMarkers";

import { resolveNewAgentGroupSessionDefaults } from "../AgentGroupSidebar.logic";
import { MARKER_SWATCH_CLASS } from "../chat/markerColors";
import { HighlightCard } from "./HighlightCard";
import { HighlightSynthesisDialog } from "./HighlightSynthesisDialog";
import type { HighlightScopeLevel, HighlightScopeState } from "./highlightScope";
import { PinnedHighlightCard } from "./PinnedHighlightCard";

const COLORS: readonly ThreadMarkerColor[] = ["yellow", "blue", "green", "pink"];
const SCOPE_PATH: ReadonlyArray<{ value: HighlightScopeLevel; label: string }> = [
  { value: "global", label: "All" },
  { value: "group", label: "Group" },
  { value: "subtree", label: "Subtree" },
  { value: "session", label: "Session" },
];

function itemId(item: HighlightListItem): string {
  return item.kind === "highlight"
    ? `highlight:${item.marker.id}`
    : `pin:${item.session.id}:${item.pin.messageId}`;
}

export function HighlightsExplorer(props: {
  state: HighlightScopeState;
  onStateChange: (state: HighlightScopeState) => void;
  onJump?: (item: HighlightListItem) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projects = useStore((state) => state.projects);
  const summaries = useStore((state) => state.sidebarThreadSummaryById);
  const syncServerShellSnapshot = useStore((state) => state.syncServerShellSnapshot);
  const [query, setQuery] = useState(props.state.query ?? "");
  const deferredQuery = useDeferredValue(query.trim());
  const [colors, setColors] = useState<readonly ThreadMarkerColor[]>([]);
  const [kinds, setKinds] = useState<readonly HighlightItemKind[]>([]);
  const [noteFilter, setNoteFilter] = useState<"all" | "with-note" | "without-note">("all");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [synthesisOpen, setSynthesisOpen] = useState(false);
  const [synthesisBusy, setSynthesisBusy] = useState(false);
  const scope = useMemo<HighlightsListInput["scope"]>(
    () =>
      props.state.level === "session"
        ? { type: "session", sessionId: props.state.sessionId }
        : props.state.level === "subtree"
          ? { type: "subtree", sessionId: props.state.sessionId }
          : props.state.level === "group"
            ? { type: "group", groupId: props.state.projectId }
            : { type: "global" },
    [props.state.level, props.state.projectId, props.state.sessionId],
  );
  const listInput = useMemo(
    () =>
      ({
        scope,
        query: deferredQuery,
        colors: [...colors],
        kinds: [...kinds],
        noteFilter,
        limit: 50,
      }) as const,
    [colors, deferredQuery, kinds, noteFilter, scope],
  );
  const listQuery = useInfiniteQuery({
    queryKey: ["highlights", listInput],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      ensureNativeApi().orchestration.listHighlights({ ...listInput, cursor: pageParam }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 15_000,
  });
  const items = useMemo(() => {
    const byId = new Map<string, HighlightListItem>();
    for (const page of listQuery.data?.pages ?? []) {
      for (const item of page.items) byId.set(itemId(item), item);
    }
    return [...byId.values()];
  }, [listQuery.data?.pages]);
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(itemId(item))),
    [items, selectedIds],
  );

  useEffect(() => setQuery(props.state.query ?? ""), [props.state.query]);
  useEffect(
    () => setSelectedIds(new Set()),
    [
      colors,
      deferredQuery,
      kinds,
      noteFilter,
      props.state.level,
      props.state.projectId,
      props.state.sessionId,
    ],
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["highlights"] });
  const setScope = (next: HighlightScopeLevel) => {
    const normalizedQuery = query.trim();
    if (normalizedQuery) {
      props.onStateChange({ ...props.state, level: next, query: normalizedQuery });
      return;
    }
    const nextState = { ...props.state, level: next };
    delete nextState.query;
    props.onStateChange(nextState);
  };
  const jumpToItem = (item: HighlightListItem) => {
    if (props.onJump) {
      props.onJump(item);
      return;
    }
    void navigate({
      to: "/$threadId",
      params: { threadId: item.session.id },
      search:
        item.kind === "highlight"
          ? { highlightId: item.marker.id }
          : { messageThreadId: item.session.id, messageId: item.message.id },
    });
  };
  const invalidateAfter = (promise: Promise<void>, title: string) =>
    void promise.then(invalidate).catch((error) =>
      toastManager.add({
        type: "error",
        title,
        description: error instanceof Error ? error.message : undefined,
      }),
    );
  const groupOptions = projects
    .filter((project) => project.kind === "project")
    .map((project) => ({ id: project.id, title: project.remoteName || project.name }));
  const lockedTargetId =
    props.state.level === "session" || props.state.level === "subtree"
      ? (selectedItems[0]?.group.id ?? props.state.projectId)
      : props.state.level === "group"
        ? props.state.projectId
        : null;
  const selectedGroupIds = new Set(selectedItems.map((item) => item.group.id));
  const defaultTargetId =
    lockedTargetId ??
    (selectedGroupIds.size === 1 ? (selectedItems[0]?.group.id ?? null) : null) ??
    props.state.projectId;

  const startSynthesis = async (input: { instruction: string; targetGroupId: ProjectId }) => {
    const targetProject = projects.find((project) => project.id === input.targetGroupId);
    if (!targetProject) return;
    setSynthesisBusy(true);
    try {
      const messageText = buildHighlightSynthesisMessage(input.instruction, selectedItems);
      const scopedSummary = summaries[props.state.sessionId] ?? null;
      const parent =
        (props.state.level === "session" || props.state.level === "subtree") &&
        scopedSummary?.projectId === targetProject.id
          ? scopedSummary
          : null;
      const defaults = resolveNewAgentGroupSessionDefaults(targetProject, parent);
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      const api = ensureNativeApi();
      await api.orchestration.dispatchCommand({
        type: "thread.create",
        commandId: newCommandId(),
        threadId,
        projectId: targetProject.id,
        title: selectedItems.length === 1 ? "Highlight synthesis" : "Highlights synthesis",
        modelSelection: defaults.modelSelection,
        runtimeMode: "full-access",
        interactionMode: defaults.interactionMode,
        envMode: defaults.envMode,
        branch: null,
        worktreePath: null,
        parentThreadId: defaults.parentThreadId,
        createdAt,
      });
      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId,
        message: { messageId: newMessageId(), role: "user", text: messageText, attachments: [] },
        runtimeMode: "full-access",
        interactionMode: defaults.interactionMode,
        createdAt,
      });
      syncServerShellSnapshot(await api.orchestration.getShellSnapshot());
      setSynthesisOpen(false);
      await navigate({ to: "/$threadId", params: { threadId } });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not create synthesis session",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSynthesisBusy(false);
    }
  };

  const controls = (
    <div className="border-b border-[var(--color-border-light)] px-3 py-2">
      <div className="flex min-w-0 items-center gap-1">
        <nav aria-label="Highlight scope" className="flex min-w-0 items-center overflow-x-auto">
          {SCOPE_PATH.map((option, index) => {
            const active = props.state.level === option.value;
            return (
              <div key={option.value} className="flex shrink-0 items-center">
                {index > 0 ? (
                  <ChevronRightIcon className="size-3 text-[var(--color-text-foreground-tertiary)]" />
                ) : null}
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => setScope(option.value)}
                  className={cn(
                    "rounded px-1.5 py-1 text-[10px] transition-colors",
                    active
                      ? "bg-[var(--color-background-elevated-secondary)] font-medium text-[var(--color-text-foreground)]"
                      : "text-[var(--color-text-foreground-secondary)] hover:text-[var(--color-text-foreground)]",
                  )}
                >
                  {option.label}
                </button>
              </div>
            );
          })}
        </nav>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Refresh highlights"
          className="ml-auto"
          onClick={() => void listQuery.refetch()}
        >
          <RefreshCwIcon className={cn(listQuery.isFetching && "animate-spin")} />
        </Button>
      </div>
      <SearchInput
        size="sm"
        className="mt-1.5"
        placeholder="Search saved content and notes"
        value={query}
        maxLength={HIGHLIGHTS_SEARCH_MAX_CHARS}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        {(["pin", "highlight"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={kinds.includes(kind)}
            onClick={() =>
              setKinds((current) =>
                current.includes(kind)
                  ? current.filter((entry) => entry !== kind)
                  : [...current, kind],
              )
            }
            className={cn(
              "rounded px-1.5 py-1 text-[10px] transition-colors",
              kinds.includes(kind)
                ? "bg-[var(--color-background-elevated-secondary)] font-medium text-[var(--color-text-foreground)]"
                : "text-[var(--color-text-foreground-secondary)] hover:text-[var(--color-text-foreground)]",
            )}
          >
            {kind === "pin" ? "Pinned" : "Highlights"}
          </button>
        ))}
        {items.length > 0 ? (
          <span className="ml-auto text-[10px] text-[var(--color-text-foreground-tertiary)]">
            {items.length} loaded
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <select
          className="h-6 rounded-md border border-[var(--color-border)] bg-transparent px-1.5 text-[10px] text-[var(--color-text-foreground-secondary)]"
          value={noteFilter}
          onChange={(event) => setNoteFilter(event.target.value as typeof noteFilter)}
        >
          <option value="all">All annotations</option>
          <option value="with-note">With annotation</option>
          <option value="without-note">Without annotation</option>
        </select>
        {COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`${color} highlights`}
            aria-pressed={colors.includes(color)}
            onClick={() =>
              setColors((current) =>
                current.includes(color)
                  ? current.filter((entry) => entry !== color)
                  : [...current, color],
              )
            }
            className={cn(
              "size-4 rounded-full border-2",
              MARKER_SWATCH_CLASS[color],
              colors.includes(color)
                ? "border-[var(--color-text-foreground)]"
                : "border-transparent opacity-50",
            )}
          />
        ))}
      </div>
    </div>
  );

  const explorer = (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-background-surface)]">
      {controls}
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="pb-16">
          {listQuery.isPending ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-24" />
              ))}
            </div>
          ) : listQuery.isError ? (
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyTitle>Could not load highlights</EmptyTitle>
                <EmptyDescription>{listQuery.error.message}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : items.length === 0 ? (
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyTitle>No saved items found</EmptyTitle>
                <EmptyDescription>
                  Pin an assistant message or select text to create a highlight.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div>
              {items.map((item) => {
                const id = itemId(item);
                const selectionProps = {
                  selected: selectedIds.has(id),
                  onSelectedChange: (selected: boolean) =>
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      if (selected) next.add(id);
                      else next.delete(id);
                      return next;
                    }),
                  onJump: () => jumpToItem(item),
                };
                return item.kind === "highlight" ? (
                  <HighlightCard
                    key={id}
                    item={item}
                    {...selectionProps}
                    onRemove={() =>
                      invalidateAfter(
                        dispatchThreadMarkerRemove(item.session.id, item.marker.id),
                        "Could not remove highlight",
                      )
                    }
                    onSaveNote={(note) =>
                      invalidateAfter(
                        dispatchThreadMarkerNoteSet(item.session.id, item.marker.id, note),
                        "Could not save note",
                      )
                    }
                  />
                ) : (
                  <PinnedHighlightCard
                    key={id}
                    item={item}
                    {...selectionProps}
                    onRemove={() =>
                      invalidateAfter(
                        dispatchPinnedMessageRemove(item.session.id, item.pin.messageId),
                        "Could not unpin message",
                      )
                    }
                    onToggleDone={() =>
                      invalidateAfter(
                        dispatchPinnedMessageDoneSet(
                          item.session.id,
                          item.pin.messageId,
                          !item.pin.done,
                        ),
                        "Could not update pinned message",
                      )
                    }
                    onSaveLabel={(label) =>
                      invalidateAfter(
                        dispatchPinnedMessageLabelSet(
                          item.session.id,
                          item.pin.messageId,
                          label,
                        ),
                        "Could not save pin label",
                      )
                    }
                  />
                );
              })}
              {listQuery.hasNextPage ? (
                <div className="flex justify-center py-3">
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={listQuery.isFetchingNextPage}
                    onClick={() => void listQuery.fetchNextPage()}
                  >
                    {listQuery.isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </main>

      {selectedItems.length > 0 ? (
        <div className="absolute inset-x-2 bottom-2 flex justify-center">
          <div className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-background-elevated-primary-opaque)] p-1 pl-2 shadow-lg">
            <span className="text-[10px]">{selectedItems.length} selected</span>
            <Button size="xs" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
            <Button size="xs" onClick={() => setSynthesisOpen(true)}>
              <SparklesIcon /> Synthesize
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      {explorer}
      <HighlightSynthesisDialog
        open={synthesisOpen}
        count={selectedItems.length}
        groups={groupOptions}
        targetGroupId={defaultTargetId}
        targetLocked={lockedTargetId !== null}
        busy={synthesisBusy}
        onOpenChange={setSynthesisOpen}
        onConfirm={(input) => void startSynthesis(input)}
      />
    </>
  );
}
