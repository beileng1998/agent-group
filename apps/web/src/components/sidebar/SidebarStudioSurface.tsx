// FILE: SidebarStudioSurface.tsx
// Purpose: Renders the flat Studio chat surface and its controls.
// Layer: Web sidebar presentation

import type { ReactNode } from "react";
import type { SidebarThreadSortOrder } from "../../appSettings";
import type { SidebarThreadSummary } from "../../types";
import type { SidebarThreadTreeRow } from "../Sidebar.treeLogic";
import { NewThreadIcon } from "~/lib/icons";
import { SidebarIconButton } from "../SidebarIconButton";
import { ChatSortMenu } from "./SidebarControls";
import { SidebarSurfaceSectionHeader } from "./SidebarSurfaceShared";
import { SidebarGroup, SidebarMenu } from "../ui/sidebar";

export type SidebarStudioSurfaceProps = {
  model: {
    rows: readonly SidebarThreadTreeRow<SidebarThreadSummary>[];
    threadsHydrated: boolean;
    threadSortOrder: SidebarThreadSortOrder;
    attachAutoAnimateRef: (node: HTMLElement | null) => void;
  };
  actions: {
    createChat: () => void;
    changeThreadSort: (sortOrder: SidebarThreadSortOrder) => void;
  };
  slots: {
    pinnedThreads: ReactNode;
    renderThread: (row: SidebarThreadTreeRow<SidebarThreadSummary>) => ReactNode;
  };
};

export function SidebarStudioSurface({ model, actions, slots }: SidebarStudioSurfaceProps) {
  return (
    <SidebarGroup className="px-1.5 py-1.5">
      {slots.pinnedThreads}
      <SidebarSurfaceSectionHeader
        label="Studio"
        toolbar={
          <>
            <SidebarIconButton
              icon={NewThreadIcon}
              label="New studio chat"
              tooltip="New studio chat"
              tooltipSide="top"
              onClick={actions.createChat}
            />
            <ChatSortMenu
              threadSortOrder={model.threadSortOrder}
              onThreadSortOrderChange={actions.changeThreadSort}
            />
          </>
        }
      />
      <SidebarMenu ref={model.attachAutoAnimateRef} className="gap-1">
        {model.rows.length > 0 ? (
          model.rows.map(slots.renderThread)
        ) : (
          <div className="px-2 pt-4 text-center text-[length:var(--app-font-size-ui,12px)] text-muted-foreground/58">
            {model.threadsHydrated ? "No studio chats yet" : "Loading Studio..."}
          </div>
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}
