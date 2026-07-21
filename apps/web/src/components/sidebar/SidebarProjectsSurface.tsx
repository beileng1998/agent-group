// FILE: SidebarProjectsSurface.tsx
// Purpose: Renders the Projects sidebar surface, including sorting, DND, paging rows, and empty states.
// Layer: Web sidebar presentation

import type { ComponentProps, ReactNode } from "react";
import type { ProjectId } from "@agent-group/contracts";
import { DndContext } from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { FiPlus } from "react-icons/fi";
import { TbArrowsDiagonal, TbArrowsDiagonalMinimize2 } from "react-icons/tb";
import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from "../../appSettings";
import type { SidebarProjectAccessOwner } from "../../hooks/useSidebarProjectAccessOwner";
import type { Project } from "../../types";
import { SidebarIconButton } from "../SidebarIconButton";
import { SidebarAddProjectPanel } from "./SidebarAddProjectPanel";
import {
  ProjectSortMenu,
  SortableProjectItem,
  type SortableProjectHandleProps,
} from "./SidebarControls";
import { SidebarSurfaceSectionHeader } from "./SidebarSurfaceShared";
import { SidebarGroup, SidebarMenu, SidebarMenuItem } from "../ui/sidebar";

type DndProps = ComponentProps<typeof DndContext>;

export type SidebarProjectsSurfaceProps = {
  model: {
    projects: readonly Project[];
    emptyState: "loading" | "empty" | null;
    allExpanded: boolean;
    focusedProjectId: ProjectId | null;
    addProjectOpen: boolean;
    sorting: {
      project: SidebarProjectSortOrder;
      thread: SidebarThreadSortOrder;
      manual: boolean;
    };
    drag: {
      sensors: NonNullable<DndProps["sensors"]>;
      collisionDetection: NonNullable<DndProps["collisionDetection"]>;
      attachAutoAnimateRef: (node: HTMLElement | null) => void;
    };
  };
  actions: {
    toggleAll: () => void;
    toggleAddProject: () => void;
    changeProjectSort: (sortOrder: SidebarProjectSortOrder) => void;
    changeThreadSort: (sortOrder: SidebarThreadSortOrder) => void;
    drag: {
      start: NonNullable<DndProps["onDragStart"]>;
      end: NonNullable<DndProps["onDragEnd"]>;
      cancel: NonNullable<DndProps["onDragCancel"]>;
    };
  };
  slots: {
    pinnedThreads: ReactNode;
    projectAccessOwner: SidebarProjectAccessOwner;
    renderProject: (
      project: Project,
      dragHandleProps: SortableProjectHandleProps | null,
    ) => ReactNode;
  };
};

export function SidebarProjectsSurface({ model, actions, slots }: SidebarProjectsSurfaceProps) {
  return (
    <SidebarGroup className="px-1.5 py-1.5">
      {slots.pinnedThreads}
      <SidebarSurfaceSectionHeader
        label="Projects"
        toolbar={
          <>
            {model.projects.length > 0 ? (
              <SidebarIconButton
                icon={model.allExpanded ? TbArrowsDiagonalMinimize2 : TbArrowsDiagonal}
                label={
                  model.allExpanded
                    ? model.focusedProjectId
                      ? "Collapse all projects except the active project"
                      : "Collapse all projects"
                    : "Expand all projects"
                }
                className="disabled:cursor-default disabled:opacity-45"
                onClick={actions.toggleAll}
                tooltip={
                  model.allExpanded
                    ? model.focusedProjectId
                      ? "Collapse all projects except the active chat's project"
                      : "Collapse all projects"
                    : "Expand all projects"
                }
                tooltipSide="bottom"
              />
            ) : null}
            <ProjectSortMenu
              projectSortOrder={model.sorting.project}
              threadSortOrder={model.sorting.thread}
              onProjectSortOrderChange={actions.changeProjectSort}
              onThreadSortOrderChange={actions.changeThreadSort}
            />
            <SidebarIconButton
              icon={FiPlus}
              label={model.addProjectOpen ? "Cancel add project" : "Add project"}
              aria-pressed={model.addProjectOpen}
              onClick={actions.toggleAddProject}
              tooltip={model.addProjectOpen ? "Cancel add project" : "Add project"}
              tooltipSide="right"
            />
          </>
        }
      />

      <SidebarAddProjectPanel owner={slots.projectAccessOwner} />
      {model.sorting.manual ? (
        <DndContext
          sensors={model.drag.sensors}
          collisionDetection={model.drag.collisionDetection}
          modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
          onDragStart={actions.drag.start}
          onDragEnd={actions.drag.end}
          onDragCancel={actions.drag.cancel}
        >
          <SidebarMenu className="gap-3">
            <SortableContext
              items={model.projects.map((project) => project.id)}
              strategy={verticalListSortingStrategy}
            >
              {model.projects.map((project) => (
                <SortableProjectItem key={project.id} projectId={project.id}>
                  {(dragHandleProps) => slots.renderProject(project, dragHandleProps)}
                </SortableProjectItem>
              ))}
            </SortableContext>
          </SidebarMenu>
        </DndContext>
      ) : (
        <SidebarMenu ref={model.drag.attachAutoAnimateRef} className="gap-3">
          {model.projects.map((project) => (
            <SidebarMenuItem key={project.id} className="rounded-md">
              {slots.renderProject(project, null)}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      )}

      {model.emptyState === "loading" && (
        <div className="space-y-2 px-2 pt-4" aria-live="polite" aria-label="Loading projects">
          <div className="text-center text-[length:var(--app-font-size-ui,12px)] text-muted-foreground/58">
            Loading projects...
          </div>
          <div className="mx-auto grid w-full max-w-42 gap-1.5 opacity-70">
            <div className="h-2 rounded-full bg-muted/55 animate-pulse" />
            <div className="mx-auto h-2 w-4/5 rounded-full bg-muted/40 animate-pulse" />
            <div className="mx-auto h-2 w-3/5 rounded-full bg-muted/30 animate-pulse" />
          </div>
        </div>
      )}

      {model.emptyState === "empty" && (
        <div className="px-2 pt-4 text-center text-[length:var(--app-font-size-ui,12px)] text-muted-foreground/58">
          No projects yet
        </div>
      )}
    </SidebarGroup>
  );
}
