// FILE: SidebarProjectMenus.tsx
// Purpose: Render the project context menu and rename dialog from one project-menu owner.
// Layer: Web sidebar leaf component

import {
  ArchiveIcon,
  CopyIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  KanbanIcon,
  PencilIcon,
  PinIcon,
  PlayIcon,
  StopFilledIcon,
  Trash2,
  XIcon,
} from "~/lib/icons";
import { pinActionLabel } from "~/lib/pin";
import type { SidebarProjectMenuOwner } from "../../hooks/useSidebarProjectMenuOwner";
import { ComposerPickerMenuPopup } from "../chat/ComposerPickerMenuPopup";
import { RenameDialog } from "../RenameDialog";
import {
  PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME,
  PROJECT_CONTEXT_MENU_PANEL_CLASS_NAME,
  ProjectContextMenuIcon,
  type ProjectContextMenuId,
} from "./SidebarProjectContextMenuValues";
import { Menu, MenuGroup, MenuItem, MenuSeparator } from "../ui/menu";

interface SidebarProjectMenusProps {
  readonly owner: SidebarProjectMenuOwner;
}

export function SidebarProjectMenus({ owner }: SidebarProjectMenusProps) {
  const { model, actions } = owner;
  const projectId = model.contextMenu?.projectId ?? null;
  const run = (action: ProjectContextMenuId) => {
    if (projectId) void actions.runAction(projectId, action);
  };

  return (
    <>
      {model.contextMenu && model.contextProject && model.contextAnchor ? (
        <Menu open onOpenChange={(open) => !open && actions.closeContextMenu()}>
          <ComposerPickerMenuPopup
            anchor={model.contextAnchor}
            align="start"
            side="bottom"
            sideOffset={0}
            className={PROJECT_CONTEXT_MENU_PANEL_CLASS_NAME}
          >
            <MenuGroup>
              <MenuItem
                className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                onClick={() => run("open-in-finder")}
              >
                <ProjectContextMenuIcon icon={FolderOpenIcon} />
                <span>Open in Finder</span>
              </MenuItem>
              <MenuItem
                className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                onClick={() => run("open-in-kanban")}
              >
                <ProjectContextMenuIcon icon={KanbanIcon} />
                <span>Open in Kanban</span>
              </MenuItem>
              <MenuItem
                className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                onClick={() => run("copy-path")}
              >
                <ProjectContextMenuIcon icon={CopyIcon} />
                <span>Copy Path</span>
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                onClick={() => run(model.isRunning ? "stop-dev" : "start-dev")}
              >
                <ProjectContextMenuIcon icon={model.isRunning ? StopFilledIcon : PlayIcon} />
                <span>{model.isRunning ? "Stop dev" : "Start dev"}</span>
              </MenuItem>
              {model.hasOpenServer ? (
                <MenuItem
                  className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                  onClick={() => run("open-dev-server")}
                >
                  <ProjectContextMenuIcon icon={ExternalLinkIcon} />
                  <span>Open dev server</span>
                </MenuItem>
              ) : null}
              <MenuSeparator />
              <MenuItem
                className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                onClick={() => run("rename")}
              >
                <ProjectContextMenuIcon icon={PencilIcon} />
                <span>Edit name</span>
              </MenuItem>
              <MenuItem
                className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                onClick={() => run("toggle-pin")}
              >
                <ProjectContextMenuIcon icon={PinIcon} />
                <span>{pinActionLabel("project", model.isPinned)}</span>
              </MenuItem>
              {model.hasArchivableThreads || model.hasAnyThreads ? <MenuSeparator /> : null}
              {model.hasArchivableThreads ? (
                <MenuItem
                  className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                  onClick={() => run("archive-threads")}
                >
                  <ProjectContextMenuIcon icon={ArchiveIcon} />
                  <span>Archive threads</span>
                </MenuItem>
              ) : null}
              {model.hasAnyThreads ? (
                <MenuItem
                  className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                  onClick={() => run("delete-threads")}
                >
                  <ProjectContextMenuIcon icon={Trash2} />
                  <span>Delete threads</span>
                </MenuItem>
              ) : null}
              <MenuSeparator />
              <MenuItem
                className={PROJECT_CONTEXT_MENU_ITEM_CLASS_NAME}
                onClick={() => run("delete")}
              >
                <ProjectContextMenuIcon icon={XIcon} />
                <span>Remove</span>
              </MenuItem>
            </MenuGroup>
          </ComposerPickerMenuPopup>
        </Menu>
      ) : null}

      <RenameDialog
        open={model.renameProject !== null}
        title="Rename project"
        description="Keep it short and recognizable."
        initialValue={model.renameProject?.localName ?? model.renameProject?.name ?? ""}
        allowEmpty
        placeholder={model.renameProject?.folderName}
        onOpenChange={(open) => !open && actions.closeRename()}
        onSave={(nextName) => {
          if (!model.renameProject) return;
          actions.saveRename(model.renameProject.id, nextName, model.renameProject.localName);
        }}
      />
    </>
  );
}
