import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ProjectId, ThreadId } from "@agent-group/contracts";
import type { ReactNode } from "react";

import {
  EllipsisIcon,
  FolderClosedIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  Trash2,
} from "~/lib/icons";
import { PinStatusIcon, pinActionLabel } from "~/lib/pin";
import { cn } from "~/lib/utils";
import type { Project, SidebarThreadSummary } from "~/types";
import { agentGroupDisplayTitle } from "./AgentGroupSidebar.logic";
import { ComposerPickerMenuPopup } from "./chat/ComposerPickerMenuPopup";
import { AgentGroupSessionTree } from "./AgentGroupSessionTree";
import { resolveProjectStatusIndicator, resolveThreadStatusPill } from "./Sidebar.logic";
import { DisclosureChevron } from "./ui/DisclosureChevron";
import { DisclosureRegion } from "./ui/DisclosureRegion";
import { Menu, MenuItem, MenuTrigger } from "./ui/menu";

type GroupDragHandle = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
>;

function SortableGroup(props: {
  children: (dragHandle: GroupDragHandle) => ReactNode;
  disabled: boolean;
  groupId: ProjectId;
}) {
  const {
    attributes,
    isDragging,
    isOver,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: props.groupId, disabled: props.disabled });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "mb-0.5 rounded-lg",
        isDragging && "z-20 opacity-80",
        isOver && !isDragging && "ring-1 ring-primary/40",
      )}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {props.children({ attributes, listeners, setActivatorNodeRef })}
    </section>
  );
}

function buildSessionTree(sessions: readonly SidebarThreadSummary[]) {
  const sessionIds = new Set(sessions.map((session) => session.id));
  const roots = sessions.filter(
    (session) =>
      session.isPinned === true ||
      !session.parentThreadId ||
      !sessionIds.has(session.parentThreadId),
  );
  const childrenByParent = new Map<string, SidebarThreadSummary[]>();
  for (const session of sessions) {
    if (
      session.isPinned === true ||
      !session.parentThreadId ||
      !sessionIds.has(session.parentThreadId)
    ) {
      continue;
    }
    const children = childrenByParent.get(session.parentThreadId) ?? [];
    childrenByParent.set(session.parentThreadId, [...children, session]);
  }
  return { childrenByParent, roots };
}

type AgentGroupSidebarGroupsProps = {
  state: {
    activeGroupId: ProjectId | null;
    activeThreadId: string | null;
    collapsedSessionIds: ReadonlySet<string>;
    creatingSessionKey: string | null;
    filtering: boolean;
  };
  data: {
    groups: readonly Project[];
    sessionsByGroup: ReadonlyMap<ProjectId, readonly SidebarThreadSummary[]>;
  };
  groupActions: {
    create: () => void;
    delete: (group: Project) => void;
    openSettings: (group: Project) => void;
    rename: (group: Project) => void;
    reorder: (draggedId: ProjectId, targetId: ProjectId) => void;
    toggleExpanded: (group: Project) => void;
    togglePin: (group: Project) => void;
  };
  sessionActions: {
    create: (group: Project, parent?: SidebarThreadSummary) => void;
    delete: (session: SidebarThreadSummary) => void;
    open: (threadId: ThreadId) => void | Promise<void>;
    openInspector: (session: SidebarThreadSummary) => void;
    rename: (session: SidebarThreadSummary) => void;
    reorder: (groupId: ProjectId, draggedId: ThreadId, targetId: ThreadId) => void;
    toggleCollapsed: (threadId: ThreadId) => void;
    togglePin: (session: SidebarThreadSummary) => void;
  };
};

export function AgentGroupSidebarGroups({
  data,
  groupActions,
  sessionActions,
  state,
}: AgentGroupSidebarGroupsProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleGroupDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const dragged = data.groups.find((group) => group.id === active.id);
    const target = data.groups.find((group) => group.id === over.id);
    if (!dragged || !target || Boolean(dragged.isPinned) !== Boolean(target.isPinned)) return;
    groupActions.reorder(dragged.id, target.id);
  };

  if (data.groups.length === 0) {
    if (state.filtering) {
      return (
        <div className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
          No matching groups or sessions
        </div>
      );
    }
    return (
      <button
        type="button"
        className="w-full rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground hover:bg-sidebar-accent/50"
        onClick={groupActions.create}
      >
        Add a folder to create your first group
      </button>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
      onDragEnd={handleGroupDragEnd}
    >
      <SortableContext
        items={data.groups.map((group) => group.id)}
        strategy={verticalListSortingStrategy}
      >
        {data.groups.map((group) => {
          const sessions = data.sessionsByGroup.get(group.id) ?? [];
          const { childrenByParent, roots } = buildSessionTree(sessions);
          const displayTitle = agentGroupDisplayTitle(group);
          const expanded = state.filtering || group.expanded;
          const hasError = sessions.some(
            (session) =>
              session.latestTurn?.state === "error" || session.session?.status === "error",
          );
          const groupStatus = hasError
            ? { label: "Error", dotClass: "bg-destructive", pulse: false }
            : resolveProjectStatusIndicator(
                sessions.map((session) =>
                  resolveThreadStatusPill({
                    thread: session,
                    hasPendingApprovals: session.hasPendingApprovals,
                    hasPendingUserInput: session.hasPendingUserInput,
                  }),
                ),
              );

          return (
            <SortableGroup key={group.id} groupId={group.id} disabled={state.filtering}>
              {(dragHandle) => (
                <>
                  <div
                    className={cn(
                      "group/group flex min-w-0 items-center rounded-lg px-1 hover:bg-sidebar-accent/55",
                      state.activeGroupId === group.id && "bg-sidebar-accent/35",
                    )}
                  >
                    {/* Keep the Group glyph on the same column as root Session provider glyphs. */}
                    <button
                      type="button"
                      aria-expanded={expanded}
                      title={`${displayTitle}\n${group.cwd}`}
                      className="flex h-8 min-w-0 flex-1 items-center gap-1.5 pe-0.5 ps-[7px] text-start text-xs font-medium outline-none focus-visible:ring-1 focus-visible:ring-ring/60 pointer-coarse:h-10"
                      onClick={() => groupActions.toggleExpanded(group)}
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center">
                        <DisclosureChevron open={expanded} className="size-3" />
                      </span>
                      <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
                      {group.isPinned ? (
                        <PinStatusIcon pinned className="size-3 shrink-0 text-muted-foreground" />
                      ) : null}
                      {groupStatus ? (
                        <span
                          aria-label={groupStatus.label}
                          title={groupStatus.label}
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            groupStatus.dotClass,
                            groupStatus.pulse && "animate-pulse",
                          )}
                        />
                      ) : null}
                      <span
                        aria-label={`${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`}
                        title={`${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`}
                        className="inline-flex h-4 min-w-5 shrink-0 items-center justify-center rounded-full bg-foreground/5 px-1 text-[9px] font-medium tabular-nums text-muted-foreground"
                      >
                        {sessions.length}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Settings for ${displayTitle}`}
                      title="Group settings"
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-background/60 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring/60 group-hover/group:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-70",
                        state.activeGroupId === group.id ? "opacity-70" : "opacity-0",
                      )}
                      onClick={() => groupActions.openSettings(group)}
                    >
                      <SettingsIcon className="size-3.5" />
                    </button>
                    {!state.filtering ? (
                      <button
                        ref={dragHandle.setActivatorNodeRef}
                        type="button"
                        aria-label={`Drag ${displayTitle}`}
                        title="Drag to reorder group"
                        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/45 opacity-0 outline-none hover:bg-background/50 hover:text-foreground hover:opacity-100 active:cursor-grabbing focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring/60 group-hover/group:opacity-70 pointer-coarse:size-8 pointer-coarse:opacity-70"
                        {...dragHandle.attributes}
                        {...dragHandle.listeners}
                      >
                        <GripVerticalIcon className="size-3.5" />
                      </button>
                    ) : null}
                    <Menu modal={false}>
                      <MenuTrigger
                        render={
                          <button
                            type="button"
                            aria-label={`Group actions for ${displayTitle}`}
                            title="Group actions"
                            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 outline-none hover:bg-background/60 hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring/60 group-hover/group:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-70"
                          />
                        }
                      >
                        <EllipsisIcon className="size-3.5" />
                      </MenuTrigger>
                      <ComposerPickerMenuPopup align="end" side="bottom" className="w-44 min-w-44">
                        <MenuItem
                          disabled={state.creatingSessionKey !== null}
                          onClick={() => sessionActions.create(group)}
                        >
                          <PlusIcon className="size-3.5" />
                          <span>New session</span>
                        </MenuItem>
                        <MenuItem onClick={() => groupActions.togglePin(group)}>
                          <PinStatusIcon pinned={group.isPinned === true} className="size-3.5" />
                          <span>{pinActionLabel("group", group.isPinned === true)}</span>
                        </MenuItem>
                        <MenuItem onClick={() => groupActions.openSettings(group)}>
                          <SettingsIcon className="size-3.5" />
                          <span>Group settings</span>
                        </MenuItem>
                        <MenuItem onClick={() => groupActions.rename(group)}>
                          <PencilIcon className="size-3.5" />
                          <span>Rename group</span>
                        </MenuItem>
                        <MenuItem variant="destructive" onClick={() => groupActions.delete(group)}>
                          <Trash2 className="size-3.5" />
                          <span>Delete group</span>
                        </MenuItem>
                      </ComposerPickerMenuPopup>
                    </Menu>
                  </div>
                  <DisclosureRegion open={expanded}>
                    {roots.length > 0 ? (
                      <AgentGroupSessionTree
                        groupId={group.id}
                        activeThreadId={state.activeThreadId}
                        collapsedSessionIds={state.collapsedSessionIds}
                        creatingSessionKey={state.creatingSessionKey}
                        forceExpanded={state.filtering}
                        roots={roots}
                        childrenByParent={childrenByParent}
                        onOpen={sessionActions.open}
                        onCreateChild={(parent) => sessionActions.create(group, parent)}
                        onDelete={sessionActions.delete}
                        onRename={sessionActions.rename}
                        onOpenInspector={sessionActions.openInspector}
                        onReorder={(draggedId, targetId) =>
                          sessionActions.reorder(group.id, draggedId, targetId)
                        }
                        onToggleCollapsed={sessionActions.toggleCollapsed}
                        onTogglePin={sessionActions.togglePin}
                      />
                    ) : (
                      <button
                        type="button"
                        className="ms-3 w-[calc(100%-0.75rem)] rounded-lg border-s border-sidebar-border/60 px-4 py-2 text-start text-[11px] text-muted-foreground hover:bg-sidebar-accent/60 disabled:opacity-50 pointer-coarse:min-h-10"
                        disabled={state.creatingSessionKey !== null}
                        onClick={() => sessionActions.create(group)}
                      >
                        {state.creatingSessionKey === `${group.id}:root`
                          ? "Creating session…"
                          : "+ New session"}
                      </button>
                    )}
                  </DisclosureRegion>
                </>
              )}
            </SortableGroup>
          );
        })}
      </SortableContext>
    </DndContext>
  );
}
