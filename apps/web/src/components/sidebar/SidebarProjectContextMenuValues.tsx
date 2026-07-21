// FILE: SidebarProjectContextMenuValues.tsx
// Purpose: Defines project context-menu identity, anchoring, and shared presentation values.
// Layer: Web sidebar presentation

import type { ProjectId } from "@agent-group/contracts";
import type { LucideIcon } from "~/lib/icons";

export type ProjectContextMenuId =
  | "open-in-finder"
  | "open-in-kanban"
  | "copy-path"
  | "start-dev"
  | "stop-dev"
  | "open-dev-server"
  | "rename"
  | "toggle-pin"
  | "archive-threads"
  | "delete-threads"
  | "delete";

export interface ProjectContextMenuState {
  projectId: ProjectId;
  position: { x: number; y: number };
}

export const PROJECT_CONTEXT_MENU_PANEL_CLASS_NAME = "w-48 min-w-48";
export const PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME =
  "text-[var(--color-text-foreground)] data-highlighted:text-[var(--color-text-foreground)]";

export function createClientPointMenuAnchor(position: { x: number; y: number }) {
  return {
    getBoundingClientRect: () => ({
      x: position.x,
      y: position.y,
      width: 0,
      height: 0,
      top: position.y,
      right: position.x,
      bottom: position.y,
      left: position.x,
    }),
  };
}

export function ProjectContextMenuIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-[var(--color-text-foreground-secondary)] [&>svg]:size-3.5 [&>[data-slot=central-icon]]:size-3.5">
      <Icon aria-hidden="true" />
    </span>
  );
}
