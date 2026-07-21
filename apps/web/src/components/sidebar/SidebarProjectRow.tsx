// FILE: SidebarProjectRow.tsx
// Purpose: Renders one sidebar project row, its hover card, nested threads, and paging controls.
// Layer: Web sidebar presentation

import type { ProjectId, ThreadId } from "@agent-group/contracts";
import { IoIosGitCompare } from "react-icons/io";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { NewThreadIcon, TerminalIcon } from "~/lib/icons";
import { PinStatusIcon, pinActionLabel } from "~/lib/pin";
import { cn } from "~/lib/utils";
import {
  disclosureContentClassName,
  disclosureShellClassName,
  DISCLOSURE_INNER_CLASS,
} from "~/lib/disclosureMotion";
import type { Project } from "../../types";
import {
  SIDEBAR_HEADER_ROW_CLASS_NAME,
  SIDEBAR_NESTED_LIST_GAP_CLASS_NAME,
  SIDEBAR_NESTED_LIST_OFFSET_CLASS_NAME,
  SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME,
  sidebarHoverRevealHideClassName,
} from "../../sidebarRowStyles";
import type {
  SidebarDerivedProjectData,
  SidebarProjectEntry,
} from "../Sidebar.projectDerivationLogic";
import { ProjectHoverCardContent } from "../ProjectHoverCardContent";
import { ProjectSidebarIcon } from "../ProjectSidebarIcon";
import { SidebarIconButton } from "../SidebarIconButton";
import { SidebarLeadingIcon } from "../SidebarLeadingIcon";
import { SidebarSectionToolbar } from "../SidebarSectionToolbar";
import {
  SIDEBAR_HOVER_CARD_POPUP_PROPS,
  SIDEBAR_HOVER_CARD_SURFACE_CLASS_NAME,
  SIDEBAR_HOVER_CARD_TRIGGER_PROPS,
} from "../sidebarHoverCardStyles";
import { abbreviateHomePath, createProjectHoverCardAnchor } from "../sidebarHoverCardAnchors";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";
import {
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../ui/sidebar";
import type { SortableProjectHandleProps } from "./SidebarControls";
import { ProjectRunIndicatorDot, SidebarStatusTrailingGlyph } from "./SidebarThreadPresentation";

export type SidebarProjectRowModel = {
  project: Project;
  data: SidebarDerivedProjectData;
  presentation: {
    homeDir: string | null;
    pinned: boolean;
    running: boolean;
    manualSorting: boolean;
    newThreadShortcutLabel: string | null;
    newTerminalThreadShortcutLabel: string | null;
  };
};

export type SidebarProjectRowActions = {
  header: {
    pointerDownCapture: () => void;
    click: (event: MouseEvent<HTMLButtonElement>, projectId: ProjectId) => void;
    keyDown: (event: KeyboardEvent<HTMLButtonElement>, projectId: ProjectId) => void;
    openContextMenu: (projectId: ProjectId, position: { x: number; y: number }) => void;
  };
  project: {
    togglePinned: (projectId: ProjectId) => void;
    edit: (projectId: ProjectId) => void;
    openPullRequests: (projectId: ProjectId) => void;
    createThread: (projectId: ProjectId, entryPoint: "chat" | "terminal") => void;
  };
  paging: {
    showMore: (projectCwd: string, currentExtraPages: number) => void;
    showLess: (projectCwd: string, currentExtraPages: number) => void;
  };
};

export type SidebarProjectRowProps = {
  model: SidebarProjectRowModel;
  actions: SidebarProjectRowActions;
  dragHandleProps: SortableProjectHandleProps | null;
  renderThreadRow: (
    entry: SidebarProjectEntry,
    orderedProjectThreadIds: readonly ThreadId[],
  ) => ReactNode;
};

function ProjectHoverCardPopup({
  project,
  homeDir,
  pinned,
  chatCount,
  actions,
}: {
  project: Project;
  homeDir: string | null;
  pinned: boolean;
  chatCount: number;
  actions: SidebarProjectRowActions["project"];
}) {
  return (
    <PreviewCardPopup
      {...SIDEBAR_HOVER_CARD_POPUP_PROPS}
      anchor={createProjectHoverCardAnchor(project.id)}
      className={SIDEBAR_HOVER_CARD_SURFACE_CLASS_NAME}
    >
      <ProjectHoverCardContent
        name={project.name}
        isPinned={pinned}
        chatCount={chatCount}
        path={abbreviateHomePath(project.cwd, homeDir)}
        onTogglePin={() => actions.togglePinned(project.id)}
        onEditProject={() => actions.edit(project.id)}
      />
    </PreviewCardPopup>
  );
}

export function SidebarProjectRow({
  model,
  actions,
  dragHandleProps,
  renderThreadRow,
}: SidebarProjectRowProps) {
  const { project, data, presentation } = model;
  const {
    orderedProjectThreadIds,
    allProjectThreadCount,
    projectStatus,
    visibleEntries,
    threadListExtraPages,
    canShowMoreThreads,
    canShowLessThreads,
  } = data;
  const collapsedProjectStatus = project.expanded ? null : projectStatus;
  const projectFolderIconClassName = presentation.pinned
    ? "opacity-0"
    : sidebarHoverRevealHideClassName("project-header");
  const projectToolbarReserveClassName =
    "group-hover/project-header:pr-[4.75rem] group-has-[:focus-visible]/project-header:pr-[4.75rem]";

  return (
    <div className="group/collapsible">
      <PreviewCard>
        <PreviewCardTrigger
          {...SIDEBAR_HOVER_CARD_TRIGGER_PROPS}
          render={
            <div className="group/project-header relative" data-project-hover-anchor={project.id} />
          }
        >
          <SidebarMenuButton
            ref={presentation.manualSorting ? dragHandleProps?.setActivatorNodeRef : undefined}
            size="sm"
            className={cn(
              SIDEBAR_HEADER_ROW_CLASS_NAME,
              "hover:bg-[var(--sidebar-accent)] group-hover/project-header:bg-[var(--sidebar-accent)] group-hover/project-header:text-[var(--sidebar-accent-foreground)]",
              presentation.manualSorting ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
            )}
            {...(presentation.manualSorting && dragHandleProps ? dragHandleProps.attributes : {})}
            {...(presentation.manualSorting && dragHandleProps ? dragHandleProps.listeners : {})}
            onPointerDownCapture={actions.header.pointerDownCapture}
            onClick={(event) => actions.header.click(event, project.id)}
            onKeyDown={(event) => actions.header.keyDown(event, project.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              actions.header.openContextMenu(project.id, {
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            <SidebarLeadingIcon
              size="sm"
              tone={SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME}
              className={projectFolderIconClassName}
            >
              <ProjectSidebarIcon cwd={project.cwd} expanded={project.expanded} />
            </SidebarLeadingIcon>
            <div
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 overflow-hidden transition-[padding] duration-150 ease-out",
                projectToolbarReserveClassName,
              )}
            >
              <span
                className={cn(
                  "truncate font-system-ui text-[length:var(--app-font-size-ui,12px)] font-normal",
                  SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME,
                )}
              >
                {project.name}
              </span>
              {project.localName ? (
                <span className="shrink-0 truncate text-[length:var(--app-font-size-ui,12px)] text-muted-foreground/40">
                  {project.folderName}
                </span>
              ) : null}
            </div>
            {presentation.running || collapsedProjectStatus ? (
              <span
                aria-label={
                  collapsedProjectStatus
                    ? `Project status: ${collapsedProjectStatus.label}`
                    : undefined
                }
                title={collapsedProjectStatus?.label}
                className={cn(
                  "ml-auto flex min-w-[1.625rem] shrink-0 items-center justify-end gap-2 self-center",
                  sidebarHoverRevealHideClassName("project-header"),
                )}
              >
                {presentation.running ? <ProjectRunIndicatorDot /> : null}
                {collapsedProjectStatus ? (
                  <SidebarStatusTrailingGlyph status={collapsedProjectStatus} />
                ) : null}
              </span>
            ) : null}
          </SidebarMenuButton>
          <button
            type="button"
            aria-label={pinActionLabel(project.name, presentation.pinned)}
            aria-pressed={presentation.pinned}
            title={pinActionLabel(project.name, presentation.pinned)}
            className={cn(
              "sidebar-icon-button absolute left-2 top-1/2 z-20 inline-flex size-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm transition-opacity hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
              SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME,
              presentation.pinned
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0 md:group-hover/project-header:pointer-events-auto md:group-hover/project-header:opacity-100 md:group-has-[:focus-visible]/project-header:pointer-events-auto md:group-has-[:focus-visible]/project-header:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100",
            )}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              actions.project.togglePinned(project.id);
            }}
          >
            <PinStatusIcon pinned={presentation.pinned} className="size-3.5" />
          </button>
          <SidebarSectionToolbar placement="overlay" revealOnHover>
            <SidebarIconButton
              icon={IoIosGitCompare}
              label={`View pull requests for ${project.name}`}
              tooltip="Pull requests"
              tooltipSide="top"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                actions.project.openPullRequests(project.id);
              }}
            />
            <SidebarIconButton
              icon={TerminalIcon}
              label={`Create new terminal thread in ${project.name}`}
              tooltip={
                presentation.newTerminalThreadShortcutLabel
                  ? `New terminal thread (${presentation.newTerminalThreadShortcutLabel})`
                  : "New terminal thread"
              }
              tooltipSide="top"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                actions.project.createThread(project.id, "terminal");
              }}
            />
            <SidebarIconButton
              icon={NewThreadIcon}
              label={`Create new thread in ${project.name}`}
              tooltip={
                presentation.newThreadShortcutLabel
                  ? `New thread (${presentation.newThreadShortcutLabel})`
                  : "New thread"
              }
              tooltipSide="top"
              data-testid="new-thread-button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                actions.project.createThread(project.id, "chat");
              }}
            />
          </SidebarSectionToolbar>
        </PreviewCardTrigger>
        <ProjectHoverCardPopup
          project={project}
          homeDir={presentation.homeDir}
          pinned={presentation.pinned}
          chatCount={allProjectThreadCount}
          actions={actions.project}
        />
      </PreviewCard>

      <div
        className={cn(
          disclosureShellClassName(project.expanded),
          SIDEBAR_NESTED_LIST_OFFSET_CLASS_NAME,
        )}
      >
        <div className={DISCLOSURE_INNER_CLASS}>
          <SidebarMenuSub
            className={cn(
              "mx-0 my-0 w-full translate-x-0 border-l-0 px-0 py-0",
              SIDEBAR_NESTED_LIST_GAP_CLASS_NAME,
              disclosureContentClassName(project.expanded),
            )}
          >
            {visibleEntries.map((entry) => renderThreadRow(entry, orderedProjectThreadIds))}

            {(canShowMoreThreads || canShowLessThreads) && (
              <SidebarMenuSubItem className="w-full">
                <div className="flex w-full items-center gap-1">
                  {canShowMoreThreads && (
                    <SidebarMenuSubButton
                      render={<button type="button" />}
                      data-thread-selection-safe
                      size="sm"
                      className="h-7 flex-1 translate-x-0 justify-start rounded-lg pr-2 pl-8 text-left text-[length:var(--app-font-size-ui,12px)] text-muted-foreground/79 hover:bg-[var(--sidebar-accent)]"
                      onClick={() => actions.paging.showMore(project.cwd, threadListExtraPages)}
                    >
                      <span>Show more</span>
                    </SidebarMenuSubButton>
                  )}
                  {canShowLessThreads && (
                    <SidebarMenuSubButton
                      render={<button type="button" />}
                      data-thread-selection-safe
                      size="sm"
                      className={cn(
                        "h-7 translate-x-0 justify-start rounded-lg text-left text-[length:var(--app-font-size-ui,12px)] text-muted-foreground/79 hover:bg-[var(--sidebar-accent)]",
                        canShowMoreThreads ? "w-auto flex-none px-2" : "flex-1 pr-2 pl-8",
                      )}
                      onClick={() => actions.paging.showLess(project.cwd, threadListExtraPages)}
                    >
                      <span>Show less</span>
                    </SidebarMenuSubButton>
                  )}
                </div>
              </SidebarMenuSubItem>
            )}
          </SidebarMenuSub>
        </div>
      </div>
    </div>
  );
}
