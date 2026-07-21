// FILE: SidebarControls.tsx
// Purpose: Render sidebar sorting, primary actions, segmented navigation, and sortable wrappers.
// Layer: Web sidebar controls

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ProjectId } from "@agent-group/contracts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { IoFilter } from "react-icons/io5";
import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from "../../appSettings";
import { splitShortcutLabel } from "../../keybindings";
import { cn } from "../../lib/utils";
import {
  resolvePendingSidebarViewSelection,
  type SidebarActionBadge,
  type SidebarView,
} from "../Sidebar.logic";
import { ComposerPickerMenuPopup } from "../chat/ComposerPickerMenuPopup";
import { SidebarIconButton } from "../SidebarIconButton";
import { SidebarLeadingIcon } from "../SidebarLeadingIcon";
import { SidebarGlyph } from "../sidebarGlyphs";
import {
  SIDEBAR_HEADER_ROW_CLASS_NAME,
  SIDEBAR_ROW_ACTIVE_CLASS_NAME,
  SIDEBAR_ROW_HOVER_CLASS_NAME,
  SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
} from "../../sidebarRowStyles";
import { Kbd, KbdGroup } from "../ui/kbd";
import { Menu, MenuGroup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

const SIDEBAR_SORT_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual",
};
const SIDEBAR_THREAD_SORT_LABELS: Record<SidebarThreadSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
};
const SIDEBAR_VIEW_LABELS: Record<SidebarView, string> = {
  threads: "Projects",
  studio: "Studio",
  workspace: "Workspace",
};
const SIDEBAR_SEGMENT_PENDING_RESET_MS = 2000;

function ThreadSortMenuItems({
  threadSortOrder,
  onThreadSortOrderChange,
}: {
  threadSortOrder: SidebarThreadSortOrder;
  onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
}) {
  return (
    <MenuRadioGroup
      value={threadSortOrder}
      onValueChange={(value) => onThreadSortOrderChange(value as SidebarThreadSortOrder)}
    >
      {(Object.entries(SIDEBAR_THREAD_SORT_LABELS) as Array<[SidebarThreadSortOrder, string]>).map(
        ([value, label]) => (
          <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
            {label}
          </MenuRadioItem>
        ),
      )}
    </MenuRadioGroup>
  );
}

export function ProjectSortMenu({
  projectSortOrder,
  threadSortOrder,
  onProjectSortOrderChange,
  onThreadSortOrderChange,
}: {
  projectSortOrder: SidebarProjectSortOrder;
  threadSortOrder: SidebarThreadSortOrder;
  onProjectSortOrderChange: (sortOrder: SidebarProjectSortOrder) => void;
  onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
}) {
  return (
    <Menu>
      <SidebarIconButton
        render={<MenuTrigger />}
        icon={IoFilter}
        label="Sort projects"
        tooltip="Sort projects"
        tooltipSide="right"
      />
      <ComposerPickerMenuPopup align="end" side="bottom" className="min-w-44">
        <MenuGroup>
          <div className="px-2 py-1 sm:text-xs font-medium text-muted-foreground">
            Sort projects
          </div>
          <MenuRadioGroup
            value={projectSortOrder}
            onValueChange={(value) => onProjectSortOrderChange(value as SidebarProjectSortOrder)}
          >
            {(Object.entries(SIDEBAR_SORT_LABELS) as Array<[SidebarProjectSortOrder, string]>).map(
              ([value, label]) => (
                <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                  {label}
                </MenuRadioItem>
              ),
            )}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuGroup>
          <div className="px-2 pt-2 pb-1 sm:text-xs font-medium text-muted-foreground">
            Sort threads
          </div>
          <ThreadSortMenuItems
            threadSortOrder={threadSortOrder}
            onThreadSortOrderChange={onThreadSortOrderChange}
          />
        </MenuGroup>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}

export function ChatSortMenu({
  threadSortOrder,
  onThreadSortOrderChange,
}: {
  threadSortOrder: SidebarThreadSortOrder;
  onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
}) {
  return (
    <Menu>
      <SidebarIconButton
        render={<MenuTrigger />}
        icon={IoFilter}
        label="Sort chats"
        tooltip="Sort chats"
        tooltipSide="top"
      />
      <ComposerPickerMenuPopup align="end" side="bottom" className="min-w-44">
        <MenuGroup>
          <div className="px-2 py-1 sm:text-xs font-medium text-muted-foreground">Sort chats</div>
          <ThreadSortMenuItems
            threadSortOrder={threadSortOrder}
            onThreadSortOrderChange={onThreadSortOrderChange}
          />
        </MenuGroup>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}

export function SidebarPrimaryAction({
  icon: Icon,
  label,
  onClick,
  active = false,
  disabled = false,
  shortcutLabel,
  badge,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  shortcutLabel?: string | null;
  badge?: SidebarActionBadge | null;
}) {
  const shortcutParts = shortcutLabel ? splitShortcutLabel(shortcutLabel) : [];
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        data-active={active}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group/sidebar-primary-action",
          SIDEBAR_HEADER_ROW_CLASS_NAME,
          active
            ? SIDEBAR_ROW_ACTIVE_CLASS_NAME
            : cn(SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME, SIDEBAR_ROW_HOVER_CLASS_NAME),
        )}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={onClick}
      >
        <SidebarLeadingIcon size="sm" tone="text-inherit">
          <SidebarGlyph icon={Icon} variant="leading" />
        </SidebarLeadingIcon>
        <span className="truncate">{label}</span>
        {badge ? (
          <span
            className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-md bg-muted px-1 text-[10px] font-medium text-muted-foreground"
            aria-label={badge.accessibleLabel}
            title={badge.accessibleLabel}
          >
            {badge.text}
          </span>
        ) : shortcutParts.length > 0 ? (
          <span className="ml-auto opacity-0 transition-opacity group-hover/sidebar-primary-action:opacity-100 group-focus-visible/sidebar-primary-action:opacity-100">
            <KbdGroup>
              {shortcutParts.map((part) => (
                <Kbd key={part}>{part}</Kbd>
              ))}
            </KbdGroup>
          </span>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export type SortableProjectHandleProps = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
>;

function SortableItem({
  id,
  disabled = false,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: (handleProps: SortableProjectHandleProps) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`group/menu-item relative rounded-md ${
        isDragging ? "z-20 opacity-80" : ""
      } ${isOver && !isDragging ? "ring-1 ring-primary/40" : ""}`}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
    >
      {children({ attributes, listeners, setActivatorNodeRef })}
    </li>
  );
}

export function SortableProjectItem({
  projectId,
  disabled = false,
  children,
}: {
  projectId: ProjectId;
  disabled?: boolean;
  children: (handleProps: SortableProjectHandleProps) => ReactNode;
}) {
  return (
    <SortableItem id={projectId} disabled={disabled}>
      {children}
    </SortableItem>
  );
}

export function SortableWorkspaceItem({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: (handleProps: SortableProjectHandleProps) => ReactNode;
}) {
  return <SortableItem id={workspaceId}>{children}</SortableItem>;
}

export function SidebarSegmentedPicker({
  views,
  activeView,
  onSelectView,
  onPrewarmView,
}: {
  views: ReadonlyArray<SidebarView>;
  activeView: SidebarView;
  onSelectView: (view: SidebarView) => void;
  onPrewarmView?: (view: SidebarView) => void;
}) {
  const [pendingView, setPendingView] = useState<SidebarView | null>(null);
  const pendingViewResetTimeoutRef = useRef<number | null>(null);
  const clearPendingViewResetTimeout = useCallback(() => {
    if (pendingViewResetTimeoutRef.current !== null) {
      window.clearTimeout(pendingViewResetTimeoutRef.current);
      pendingViewResetTimeoutRef.current = null;
    }
  }, []);
  useEffect(() => {
    clearPendingViewResetTimeout();
    setPendingView(null);
  }, [activeView, clearPendingViewResetTimeout]);
  useEffect(() => clearPendingViewResetTimeout, [clearPendingViewResetTimeout]);
  if (views.length < 2) return null;

  const displayedView = pendingView ?? activeView;
  const handleSelectView = (view: SidebarView) => {
    const nextPendingView = resolvePendingSidebarViewSelection(activeView, view);
    clearPendingViewResetTimeout();
    setPendingView(nextPendingView);
    if (nextPendingView !== null) {
      onPrewarmView?.(view);
      pendingViewResetTimeoutRef.current = window.setTimeout(() => {
        pendingViewResetTimeoutRef.current = null;
        setPendingView(null);
      }, SIDEBAR_SEGMENT_PENDING_RESET_MS);
    }
    onSelectView(view);
  };
  const activeIndex = views.indexOf(displayedView);
  const segmentCount = views.length;
  const activeSegment = Math.max(0, activeIndex);
  const isFirstActive = activeSegment === 0;
  const isLastActive = activeSegment === segmentCount - 1;
  const cell = `(100% - 0.25rem) / ${segmentCount}`;
  const overhang = "5px";
  const chipLeft = isFirstActive
    ? `calc(-1px - ${overhang})`
    : `calc(0.125rem + ${activeSegment} * (${cell}))`;
  const chipWidth =
    isFirstActive || isLastActive
      ? `calc(${cell} + 0.125rem + 1px + ${overhang})`
      : `calc(${cell})`;

  return (
    <div className="px-3 pt-0.5 pb-2.5">
      <div className="sidebar-segmented-picker relative isolate inline-flex w-full rounded-lg p-0.5">
        <div
          aria-hidden
          className={cn(
            "sidebar-segmented-thumb pointer-events-none absolute -inset-y-[1.5px] z-0 rounded-md transition-[left,width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
            activeIndex < 0 && "opacity-0",
          )}
          style={{ left: chipLeft, width: chipWidth }}
        />
        {views.map((view) => {
          const active = displayedView === view;
          return (
            <button
              key={view}
              type="button"
              className={cn(
                "relative z-10 flex-1 rounded-md px-2.5 py-0.5 text-[11.5px] font-medium transition-colors duration-200",
                active
                  ? "text-[var(--color-text-foreground)]"
                  : "text-[var(--color-text-foreground-secondary)] hover:text-[var(--color-text-foreground)]",
              )}
              onPointerEnter={() => {
                if (view !== activeView) onPrewarmView?.(view);
              }}
              onClick={() => handleSelectView(view)}
            >
              {SIDEBAR_VIEW_LABELS[view]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
