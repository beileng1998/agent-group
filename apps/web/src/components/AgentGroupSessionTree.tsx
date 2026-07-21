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

import { useAgentGroupAwareness } from "~/hooks/useAgentGroupAwareness";
import {
  EllipsisIcon,
  FocusIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  Trash2,
} from "~/lib/icons";
import { PinStatusIcon, pinActionLabel } from "~/lib/pin";
import { cn } from "~/lib/utils";
import type { SidebarThreadSummary } from "~/types";
import {
  agentGroupSessionNeedsAttention,
  agentGroupSessionStatusShortLabel,
  resolveAgentGroupSessionStatusTarget,
} from "./AgentGroupSessionStatus";
import { ComposerPickerMenuPopup } from "./chat/ComposerPickerMenuPopup";
import { DisclosureChevron } from "./ui/DisclosureChevron";
import { DisclosureRegion } from "./ui/DisclosureRegion";
import { Menu, MenuItem, MenuTrigger } from "./ui/menu";
import { ProviderIcon } from "./ProviderIcon";

function hasDescendant(
  childrenByParent: ReadonlyMap<string, SidebarThreadSummary[]>,
  parentId: string,
  targetId: string | null,
  visited = new Set<string>(),
): boolean {
  if (!targetId || visited.has(parentId)) return false;
  visited.add(parentId);
  return (childrenByParent.get(parentId) ?? []).some(
    (child) =>
      child.id === targetId || hasDescendant(childrenByParent, child.id, targetId, visited),
  );
}

function SessionRow(props: {
  activeThreadId: string | null;
  collapsedSessionIds: ReadonlySet<string>;
  creatingSessionKey: string | null;
  depth: number;
  forceExpanded: boolean;
  thread: SidebarThreadSummary;
  childrenByParent: ReadonlyMap<string, SidebarThreadSummary[]>;
  visited: ReadonlySet<string>;
  onOpen: (threadId: ThreadId) => void | Promise<void>;
  onCreateChild: (thread: SidebarThreadSummary) => void;
  onDelete: (thread: SidebarThreadSummary) => void;
  onRename: (thread: SidebarThreadSummary) => void;
  onOpenInspector: (thread: SidebarThreadSummary) => void;
  onToggleCollapsed: (threadId: ThreadId) => void;
  onTogglePin: (thread: SidebarThreadSummary) => void;
  awarenessBySessionId: ReadonlyMap<string, boolean>;
  awarenessDefaultEnabled: boolean;
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
  } = useSortable({
    id: props.thread.id,
    disabled: props.forceExpanded,
    data: {
      isPinned: props.thread.isPinned === true,
      parentThreadId: props.thread.isPinned ? null : (props.thread.parentThreadId ?? null),
    },
  });
  if (props.visited.has(props.thread.id)) return null;
  const nextVisited = new Set(props.visited).add(props.thread.id);
  const children = props.childrenByParent.get(props.thread.id) ?? [];
  const hasActiveDescendant = hasDescendant(
    props.childrenByParent,
    props.thread.id,
    props.activeThreadId,
  );
  const collapsed = !props.forceExpanded && props.collapsedSessionIds.has(props.thread.id);
  const title = props.thread.title || "New session";
  const statusTarget = resolveAgentGroupSessionStatusTarget({
    childrenByParent: props.childrenByParent,
    includeDescendants: collapsed,
    thread: props.thread,
  });
  const status = statusTarget?.status ?? null;
  const showActionableStatus = agentGroupSessionNeedsAttention(status);
  const provider =
    props.thread.session?.status === "running" || props.thread.session?.status === "connecting"
      ? props.thread.session.provider
      : props.thread.modelSelection.provider;
  const awarenessEnabled =
    props.awarenessBySessionId.get(props.thread.id) ?? props.awarenessDefaultEnabled;

  return (
    <li
      ref={setNodeRef}
      role="treeitem"
      aria-level={props.depth + 1}
      aria-expanded={children.length > 0 ? !collapsed : undefined}
      className={cn(
        "rounded-lg",
        isDragging && "z-20 opacity-80",
        isOver && !isDragging && "ring-1 ring-primary/40",
      )}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <div
        className={cn(
          "group/session flex min-w-0 items-center rounded-lg px-1 text-xs",
          props.activeThreadId === props.thread.id
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : hasActiveDescendant
              ? "bg-sidebar-accent/35 text-sidebar-accent-foreground"
              : "text-sidebar-foreground/78 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
        )}
      >
        {children.length > 0 ? (
          <button
            type="button"
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
            aria-expanded={!collapsed}
            className="flex size-5 shrink-0 items-center justify-center rounded outline-none hover:bg-background/50 focus-visible:ring-1 focus-visible:ring-ring/60 pointer-coarse:size-8"
            onClick={() => props.onToggleCollapsed(props.thread.id)}
          >
            <DisclosureChevron open={!collapsed} className="size-3" />
          </button>
        ) : (
          <span aria-hidden className="size-5 shrink-0 pointer-coarse:size-8" />
        )}
        <button
          type="button"
          title={title}
          className="flex h-8 min-w-0 flex-1 items-center gap-1.5 text-start outline-none focus-visible:ring-1 focus-visible:ring-ring/60 pointer-coarse:h-10"
          onClick={() => void props.onOpen(props.thread.id)}
        >
          <ProviderIcon provider={provider} className="size-3.5 shrink-0" />
          <span className="flex min-w-0 flex-1 items-center gap-1">
            <span className="min-w-0 truncate">{title}</span>
            {awarenessEnabled ? (
              <>
                <FocusIcon className="size-3 shrink-0 text-muted-foreground/65" />
                <span className="sr-only">Awareness on</span>
              </>
            ) : null}
          </span>
          {props.thread.isPinned ? (
            <PinStatusIcon pinned className="size-3 shrink-0 text-muted-foreground" />
          ) : null}
          {status && !showActionableStatus ? (
            <span
              aria-label={`${statusTarget?.title ?? title}: ${status.label}`}
              title={`${statusTarget?.title ?? title}: ${status.label}`}
              className={cn("size-1.5 shrink-0 rounded-full", status.dotClass)}
            />
          ) : null}
        </button>
        {statusTarget && showActionableStatus ? (
          <button
            type="button"
            aria-label={`${statusTarget.title}: ${statusTarget.status.label}`}
            title={`${statusTarget.title}: ${statusTarget.status.label}`}
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium outline-none hover:bg-background/60 focus-visible:ring-1 focus-visible:ring-ring/60",
              statusTarget.status.colorClass,
            )}
            onClick={() => void props.onOpen(statusTarget.threadId)}
          >
            {agentGroupSessionStatusShortLabel(statusTarget.status)}
          </button>
        ) : null}
        {!props.forceExpanded ? (
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={`Drag ${title}`}
            title="Drag to reorder session"
            className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/40 opacity-0 outline-none hover:bg-background/50 hover:text-foreground hover:opacity-100 active:cursor-grabbing focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring/60 group-hover/session:opacity-70 pointer-coarse:size-8 pointer-coarse:opacity-70"
            {...attributes}
            {...listeners}
          >
            <GripVerticalIcon className="size-3" />
          </button>
        ) : null}
        <Menu modal={false}>
          <MenuTrigger
            render={
              <button
                type="button"
                aria-label={`Session actions for ${title}`}
                title="Session actions"
                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 outline-none hover:bg-background/60 hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring/60 group-hover/session:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-70"
              />
            }
          >
            <EllipsisIcon className="size-3.5" />
          </MenuTrigger>
          <ComposerPickerMenuPopup align="end" side="bottom" className="w-44 min-w-44">
            <MenuItem
              disabled={props.creatingSessionKey !== null}
              onClick={() => props.onCreateChild(props.thread)}
            >
              <PlusIcon className="size-3.5" />
              <span>New child session</span>
            </MenuItem>
            <MenuItem onClick={() => props.onRename(props.thread)}>
              <PencilIcon className="size-3.5" />
              <span>Rename session</span>
            </MenuItem>
            <MenuItem onClick={() => props.onTogglePin(props.thread)}>
              <PinStatusIcon pinned={props.thread.isPinned === true} className="size-3.5" />
              <span>{pinActionLabel("session", props.thread.isPinned === true)}</span>
            </MenuItem>
            <MenuItem onClick={() => props.onOpenInspector(props.thread)}>
              <SettingsIcon className="size-3.5" />
              <span>Open session panel</span>
            </MenuItem>
            <MenuItem variant="destructive" onClick={() => props.onDelete(props.thread)}>
              <Trash2 className="size-3.5" />
              <span>Delete session</span>
            </MenuItem>
          </ComposerPickerMenuPopup>
        </Menu>
      </div>
      {children.length > 0 ? (
        <DisclosureRegion open={!collapsed}>
          <div className="ms-2 border-s border-sidebar-border/60 ps-1">
            <SortableContext
              items={children.map((child) => child.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul role="group">
                {children.map((child) => (
                  <SessionRow
                    key={child.id}
                    {...props}
                    depth={props.depth + 1}
                    thread={child}
                    visited={nextVisited}
                  />
                ))}
              </ul>
            </SortableContext>
          </div>
        </DisclosureRegion>
      ) : null}
    </li>
  );
}

export function AgentGroupSessionTree(props: {
  groupId: ProjectId;
  activeThreadId: string | null;
  collapsedSessionIds: ReadonlySet<string>;
  creatingSessionKey: string | null;
  forceExpanded?: boolean;
  roots: readonly SidebarThreadSummary[];
  childrenByParent: ReadonlyMap<string, SidebarThreadSummary[]>;
  onOpen: (threadId: ThreadId) => void | Promise<void>;
  onCreateChild: (thread: SidebarThreadSummary) => void;
  onDelete: (thread: SidebarThreadSummary) => void;
  onRename: (thread: SidebarThreadSummary) => void;
  onOpenInspector: (thread: SidebarThreadSummary) => void;
  onReorder: (draggedId: ThreadId, targetId: ThreadId) => void;
  onToggleCollapsed: (threadId: ThreadId) => void;
  onTogglePin: (thread: SidebarThreadSummary) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const awareness = useAgentGroupAwareness(props.groupId);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeData = active.data.current as
      | { isPinned?: boolean; parentThreadId?: string | null }
      | undefined;
    const overData = over.data.current as
      | { isPinned?: boolean; parentThreadId?: string | null }
      | undefined;
    if (
      !activeData ||
      !overData ||
      activeData.parentThreadId !== overData.parentThreadId ||
      activeData.isPinned !== overData.isPinned ||
      typeof active.id !== "string" ||
      typeof over.id !== "string"
    ) {
      return;
    }
    props.onReorder(active.id as ThreadId, over.id as ThreadId);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={props.roots.map((thread) => thread.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul role="tree" className="ms-2 border-s border-sidebar-border/60 py-0.5 ps-1">
          {props.roots.map((thread) => (
            <SessionRow
              key={thread.id}
              {...props}
              depth={0}
              forceExpanded={props.forceExpanded === true}
              thread={thread}
              visited={new Set()}
              awarenessBySessionId={awareness.awarenessBySessionId}
              awarenessDefaultEnabled={awareness.awarenessDefaultEnabled}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
