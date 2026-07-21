// FILE: SidebarWorkspaceSection.tsx
// Purpose: Render the draggable terminal workspace list from its focused owner.
// Layer: Web sidebar presentation

import { DndContext, closestCorners, type DndContextProps } from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { TerminalIcon, Trash2 } from "~/lib/icons";
import { cn } from "~/lib/utils";
import type { SidebarWorkspaceOwner } from "../../hooks/useSidebarWorkspaceOwner";
import { SIDEBAR_SECTION_LABEL_CLASS_NAME } from "../../sidebarRowStyles";
import { SidebarIconButton } from "../SidebarIconButton";
import { SidebarLeadingIcon } from "../SidebarLeadingIcon";
import { SidebarGlyph } from "../sidebarGlyphs";
import { SortableWorkspaceItem } from "./SidebarControls";
import { SidebarGroup, SidebarMenu, SidebarMenuButton } from "../ui/sidebar";

interface SidebarWorkspaceSectionProps {
  owner: SidebarWorkspaceOwner;
  sensors: NonNullable<DndContextProps["sensors"]>;
}

export function SidebarWorkspaceSection({ owner, sensors }: SidebarWorkspaceSectionProps) {
  const { actions, model } = owner;
  return (
    <SidebarGroup className="px-1.5 pt-1 pb-1.5">
      <div className="my-2 h-px w-full bg-border" />
      <div className="mb-1.5 flex items-center px-2">
        <span className={SIDEBAR_SECTION_LABEL_CLASS_NAME}>Workspace</span>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
        onDragEnd={actions.handleDragEnd}
      >
        <SidebarMenu className="gap-0.5">
          <SortableContext
            items={model.rows.map((workspace) => workspace.id)}
            strategy={verticalListSortingStrategy}
          >
            {model.rows.map((workspace) => {
              const isActive = model.routeWorkspaceId === workspace.id;
              const isRenaming = model.renamingWorkspaceId === workspace.id;
              return (
                <SortableWorkspaceItem key={workspace.id} workspaceId={workspace.id}>
                  {(dragHandleProps) =>
                    isRenaming ? (
                      <div className="px-1.5 py-0.5">
                        <input
                          autoFocus
                          value={model.renamingWorkspaceTitle}
                          onChange={(event) =>
                            actions.setRenamingWorkspaceTitle(event.target.value)
                          }
                          onBlur={actions.commitRename}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              actions.commitRename();
                            }
                            if (event.key === "Escape") {
                              event.preventDefault();
                              actions.cancelRename(workspace.title);
                            }
                          }}
                          className="h-7 w-full rounded-md border border-[color:var(--color-border)] bg-[var(--color-background-control-opaque)] px-2 text-[length:var(--app-font-size-ui,12px)] text-[var(--color-text-foreground)] outline-none focus:border-[color:var(--color-border-focus)]"
                        />
                      </div>
                    ) : (
                      <>
                        <SidebarMenuButton
                          size="sm"
                          isActive={isActive}
                          className="h-8 gap-2 rounded-lg pl-2 pr-8 font-system-ui text-[length:var(--app-font-size-ui,12px)] font-normal text-foreground/89 transition-colors hover:bg-[var(--sidebar-accent)] data-[active=true]:bg-[var(--sidebar-accent-active)] data-[active=true]:text-[var(--sidebar-accent-foreground)]"
                          onClick={() => actions.navigateToWorkspace(workspace.id)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            actions.beginRename(workspace.id, workspace.title);
                          }}
                        >
                          <SidebarLeadingIcon
                            ref={dragHandleProps.setActivatorNodeRef}
                            {...dragHandleProps.attributes}
                            {...dragHandleProps.listeners}
                            size="sm"
                            tone="text-muted-foreground/65"
                            className="cursor-grab active:cursor-grabbing"
                          >
                            <SidebarGlyph icon={TerminalIcon} variant="chrome" />
                          </SidebarLeadingIcon>
                          <span className="min-w-0 flex-1 truncate">{workspace.title}</span>
                          {workspace.terminalStatus && (
                            <span
                              className={cn(
                                "inline-flex size-1.5 shrink-0 rounded-full",
                                workspace.terminalStatus.label === "Terminal input needed"
                                  ? "bg-amber-500 dark:bg-amber-300/90"
                                  : workspace.terminalStatus.label === "Terminal process running"
                                    ? "bg-teal-500 dark:bg-teal-300/90"
                                    : "bg-emerald-500 dark:bg-emerald-300/90",
                              )}
                            />
                          )}
                          {workspace.terminalCount > 0 && (
                            <span className="shrink-0 text-[length:var(--app-font-size-ui-xs,10px)] tabular-nums text-muted-foreground/50">
                              {workspace.terminalCount}
                            </span>
                          )}
                        </SidebarMenuButton>
                        <SidebarIconButton
                          icon={Trash2}
                          label="Delete workspace"
                          glyph="meta"
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 opacity-0 transition-opacity group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100"
                          onClick={(event) => {
                            event.stopPropagation();
                            void actions.remove(workspace.id);
                          }}
                        />
                      </>
                    )
                  }
                </SortableWorkspaceItem>
              );
            })}
          </SortableContext>
        </SidebarMenu>
      </DndContext>
    </SidebarGroup>
  );
}
