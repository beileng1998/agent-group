// FILE: useSidebarProjectListOwner.ts
// Purpose: Own sidebar project expansion, manual sorting, drag guards, and list animation.
// Layer: Web sidebar controller

import {
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { ProjectId } from "@agent-group/contracts";
import { autoAnimate } from "@formkit/auto-animate";
import { useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import type { SidebarProjectSortOrder } from "../appSettings";
import { shouldClearThreadSelectionOnMouseDown } from "../components/Sidebar.logic";
import type { Project } from "../types";

interface UseSidebarProjectListOwnerInput {
  readonly projects: readonly Project[];
  readonly sortOrder: SidebarProjectSortOrder;
  readonly selectedThreadCount: number;
  readonly focusedProjectId: ProjectId | null;
  readonly allProjectsExpanded: boolean;
  readonly reorderProjects: (activeProjectId: ProjectId, overProjectId: ProjectId) => void;
  readonly toggleProject: (projectId: ProjectId) => void;
  readonly clearSelection: () => void;
  readonly setAllProjectsExpanded: (expanded: boolean) => void;
  readonly collapseProjectsExcept: (projectId: ProjectId | null) => void;
}

export function useSidebarProjectListOwner({
  projects,
  sortOrder,
  selectedThreadCount,
  focusedProjectId,
  allProjectsExpanded,
  reorderProjects,
  toggleProject,
  clearSelection,
  setAllProjectsExpanded,
  collapseProjectsExcept,
}: UseSidebarProjectListOwnerInput) {
  const dragInProgressRef = useRef(false);
  const suppressClickAfterDragRef = useRef(false);
  const animatedListsRef = useRef(new WeakSet<HTMLElement>());
  const manualSorting = sortOrder === "manual";
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const collisions = pointerWithin(args);
    return collisions.length > 0 ? collisions : closestCorners(args);
  }, []);
  const dragEnd = useCallback(
    (event: DragEndEvent) => {
      dragInProgressRef.current = false;
      if (!manualSorting) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeProject = projects.find((project) => project.id === active.id);
      const overProject = projects.find((project) => project.id === over.id);
      if (activeProject && overProject) reorderProjects(activeProject.id, overProject.id);
    },
    [manualSorting, projects, reorderProjects],
  );
  const dragStart = useCallback(
    (_event: DragStartEvent) => {
      if (!manualSorting) return;
      dragInProgressRef.current = true;
      suppressClickAfterDragRef.current = true;
    },
    [manualSorting],
  );
  const dragCancel = useCallback((_event: DragCancelEvent) => {
    dragInProgressRef.current = false;
  }, []);
  const attachAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedListsRef.current.has(node)) return;
    autoAnimate(node, { duration: 180, easing: "ease-out" });
    animatedListsRef.current.add(node);
  }, []);
  const titlePointerDownCapture = useCallback(() => {
    suppressClickAfterDragRef.current = false;
  }, []);
  const titleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>, projectId: ProjectId) => {
      if (dragInProgressRef.current || suppressClickAfterDragRef.current) {
        suppressClickAfterDragRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (selectedThreadCount > 0) clearSelection();
      toggleProject(projectId);
    },
    [clearSelection, selectedThreadCount, toggleProject],
  );
  const titleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, projectId: ProjectId) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (!dragInProgressRef.current) toggleProject(projectId);
    },
    [toggleProject],
  );
  useEffect(() => {
    const clearOnOutsideMouseDown = (event: globalThis.MouseEvent) => {
      if (selectedThreadCount === 0) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (shouldClearThreadSelectionOnMouseDown(target)) clearSelection();
    };
    window.addEventListener("mousedown", clearOnOutsideMouseDown);
    return () => window.removeEventListener("mousedown", clearOnOutsideMouseDown);
  }, [clearSelection, selectedThreadCount]);
  const toggleAll = useCallback(() => {
    if (allProjectsExpanded) {
      collapseProjectsExcept(focusedProjectId);
      return;
    }
    setAllProjectsExpanded(true);
  }, [allProjectsExpanded, collapseProjectsExcept, focusedProjectId, setAllProjectsExpanded]);

  return {
    model: { manualSorting, sensors, collisionDetection, attachAutoAnimateRef },
    actions: {
      dragEnd,
      dragStart,
      dragCancel,
      titlePointerDownCapture,
      titleClick,
      titleKeyDown,
      toggleAll,
    },
  };
}
