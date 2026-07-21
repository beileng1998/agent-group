// FILE: SidebarOverlays.tsx
// Purpose: Render sidebar project, thread-rename, and search-palette overlays.
// Layer: Web sidebar overlay component

import { ThreadId, type ProjectId } from "@agent-group/contracts";
import { useNavigate } from "@tanstack/react-router";
import type { SidebarProjectAccessOwner } from "../../hooks/useSidebarProjectAccessOwner";
import type { SidebarProjectMenuOwner } from "../../hooks/useSidebarProjectMenuOwner";
import type { SidebarProjectRunDialogModel } from "../../hooks/useSidebarProjectRunOwner";
import type { SidebarThreadInteractionOwner } from "../../hooks/useSidebarThreadInteractionOwner";
import type { SidebarThreadSummary } from "../../types";
import { RenameThreadDialog } from "../RenameThreadDialog";
import { type ImportProviderKind, type SidebarSearchPaletteMode } from "../SidebarSearchPalette";
import { SidebarSearchPaletteController } from "../SidebarSearchPaletteController";
import type { SidebarSearchAction, SidebarSearchProject } from "../SidebarSearchPalette.logic";
import { SidebarProjectMenus } from "./SidebarProjectMenus";
import { SidebarProjectRunDialog } from "./SidebarProjectRunDialog";

export type SidebarOverlaysProps = {
  readonly project: {
    readonly menuOwner: SidebarProjectMenuOwner;
    readonly accessOwner: SidebarProjectAccessOwner;
    readonly byId: ReadonlyMap<ProjectId, { readonly name: string; readonly remoteName: string }>;
    readonly run: {
      readonly model: SidebarProjectRunDialogModel;
      readonly actions: {
        readonly close: () => void;
        readonly setCommand: (command: string) => void;
        readonly confirm: () => void;
      };
    };
  };
  readonly thread: {
    readonly interactionOwner: SidebarThreadInteractionOwner;
    readonly summaryById: Readonly<Record<string, SidebarThreadSummary>>;
    readonly importFromProvider: (
      provider: ImportProviderKind,
      externalId: string,
    ) => Promise<void>;
  };
  readonly palette: {
    readonly model: {
      readonly open: boolean;
      readonly mode: SidebarSearchPaletteMode;
      readonly initialBrowseQuery: string | null;
      readonly actions: readonly SidebarSearchAction[];
      readonly projects: readonly SidebarSearchProject[];
      readonly homeDir: string | null;
    };
    readonly actions: {
      readonly setMode: (mode: SidebarSearchPaletteMode) => void;
      readonly setOpen: (open: boolean) => void;
    };
  };
  readonly surface: {
    readonly model: {
      readonly isOnStudio: boolean;
    };
    readonly actions: {
      readonly createStudioChat: () => Promise<void>;
      readonly createHomeChat: () => Promise<void>;
    };
  };
};

export function SidebarOverlays({ project, thread, palette, surface }: SidebarOverlaysProps) {
  const navigate = useNavigate();
  const renameThreadId = thread.interactionOwner.model.renameThreadId;

  return (
    <>
      <SidebarProjectMenus owner={project.menuOwner} />

      <SidebarProjectRunDialog
        model={project.run.model}
        onClose={project.run.actions.close}
        onCommandChange={project.run.actions.setCommand}
        onConfirm={project.run.actions.confirm}
      />

      <RenameThreadDialog
        open={renameThreadId !== null}
        currentTitle={renameThreadId ? (thread.summaryById[renameThreadId]?.title ?? "") : ""}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) thread.interactionOwner.actions.closeRename();
        }}
        onSave={(newTitle) => {
          const targetThreadId = thread.interactionOwner.model.renameThreadId;
          if (targetThreadId === null) return;
          const target = thread.summaryById[targetThreadId];
          if (!target) return;
          void thread.interactionOwner.actions.commitRename(target.id, newTitle, target.title);
        }}
      />

      {palette.model.open ? (
        <SidebarSearchPaletteController
          open={palette.model.open}
          mode={palette.model.mode}
          initialBrowseQuery={palette.model.initialBrowseQuery}
          onModeChange={palette.actions.setMode}
          onOpenChange={palette.actions.setOpen}
          actions={palette.model.actions}
          projects={palette.model.projects}
          projectById={project.byId}
          onCreateChat={() =>
            // Segment-aware, matching the sidebar's + action: "New chat" from the palette while
            // on the Studio segment opens a Studio chat, not a home draft.
            void (surface.model.isOnStudio
              ? surface.actions.createStudioChat()
              : surface.actions.createHomeChat())
          }
          onCreateThread={project.accessOwner.actions.createPrimaryThread}
          onAddProjectPath={project.accessOwner.actions.addFromPath}
          homeDir={palette.model.homeDir}
          onOpenSettings={() => {
            void navigate({ to: "/settings" });
          }}
          onOpenUsageSettings={() => {
            void navigate({
              to: "/settings",
              search: { section: "usage" },
            });
          }}
          onOpenProject={project.accessOwner.actions.openProjectFromSearch}
          onImportThread={thread.importFromProvider}
          onOpenThread={(threadId) => {
            thread.interactionOwner.actions.activate(ThreadId.makeUnsafe(threadId));
          }}
        />
      ) : null}
    </>
  );
}
