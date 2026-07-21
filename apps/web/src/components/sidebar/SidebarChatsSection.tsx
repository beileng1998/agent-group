// FILE: SidebarChatsSection.tsx
// Purpose: Renders the optional collapsible Chats section and its paging controls.
// Layer: Web sidebar presentation

import type { ReactNode } from "react";
import type { SidebarThreadSortOrder } from "../../appSettings";
import { NewThreadIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import {
  disclosureContentClassName,
  disclosureShellClassName,
  DISCLOSURE_INNER_CLASS,
} from "~/lib/disclosureMotion";
import {
  SIDEBAR_HEADER_ROW_CLASS_NAME,
  SIDEBAR_ROW_HOVER_CLASS_NAME,
  SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
} from "../../sidebarRowStyles";
import { SidebarIconButton } from "../SidebarIconButton";
import { SidebarSectionToolbar } from "../SidebarSectionToolbar";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { ChatSortMenu } from "./SidebarControls";

export type SidebarChatsSectionProps = {
  model: {
    open: boolean;
    hasAnyRows: boolean;
    threadSortOrder: SidebarThreadSortOrder;
    newChatShortcutLabel: string | null;
    paging: {
      canShowMore: boolean;
      canShowLess: boolean;
      effectiveExtraPages: number;
    };
  };
  actions: {
    toggle: () => void;
    createChat: () => void;
    changeThreadSort: (sortOrder: SidebarThreadSortOrder) => void;
    showMore: (currentExtraPages: number) => void;
    showLess: (currentExtraPages: number) => void;
  };
  slots: {
    renderRows: () => ReactNode;
  };
};

export function SidebarChatsSection({ model, actions, slots }: SidebarChatsSectionProps) {
  return (
    <SidebarGroup className="sidebar-surface-enter px-1.5 pt-1 pb-2">
      <div className="group/collapsible">
        <div className="group/project-header relative">
          <SidebarMenuButton
            size="sm"
            aria-expanded={model.open}
            className={cn(
              SIDEBAR_HEADER_ROW_CLASS_NAME,
              SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
              SIDEBAR_ROW_HOVER_CLASS_NAME,
              "cursor-pointer",
            )}
            onClick={actions.toggle}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              actions.toggle();
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              <span className="truncate font-system-ui text-[length:var(--app-font-size-ui,12px)] font-normal text-muted-foreground/79">
                Chats
              </span>
              <DisclosureChevron open={model.open} className="text-muted-foreground/79" />
            </div>
          </SidebarMenuButton>
          <SidebarSectionToolbar placement="overlay" revealOnHover>
            <ChatSortMenu
              threadSortOrder={model.threadSortOrder}
              onThreadSortOrderChange={actions.changeThreadSort}
            />
            <SidebarIconButton
              icon={NewThreadIcon}
              label="Open new chat home"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                actions.createChat();
              }}
              tooltip={
                model.newChatShortcutLabel ? `New chat (${model.newChatShortcutLabel})` : "New chat"
              }
              tooltipSide="top"
            />
          </SidebarSectionToolbar>
        </div>

        <div className={cn(disclosureShellClassName(model.open), "pt-1")}>
          <div className={DISCLOSURE_INNER_CLASS}>
            <SidebarMenu className={cn("gap-1", disclosureContentClassName(model.open))}>
              {model.hasAnyRows ? (
                slots.renderRows()
              ) : (
                <div className="px-2 py-2 text-[length:var(--app-font-size-ui,12px)] text-muted-foreground/48">
                  No chats yet
                </div>
              )}
              {model.paging.canShowMore || model.paging.canShowLess ? (
                <SidebarMenuItem className="w-full">
                  <div className="flex w-full items-center gap-1">
                    {model.paging.canShowMore ? (
                      <SidebarMenuButton
                        size="sm"
                        className="h-7 flex-1 justify-start rounded-lg pr-2 pl-8 text-left text-[length:var(--app-font-size-ui,12px)] font-normal text-muted-foreground/79 hover:bg-[var(--sidebar-accent)]"
                        onClick={() => actions.showMore(model.paging.effectiveExtraPages)}
                      >
                        <span>Show more</span>
                      </SidebarMenuButton>
                    ) : null}
                    {model.paging.canShowLess ? (
                      <SidebarMenuButton
                        size="sm"
                        className={cn(
                          "h-7 justify-start rounded-lg text-left text-[length:var(--app-font-size-ui,12px)] font-normal text-muted-foreground/79 hover:bg-[var(--sidebar-accent)]",
                          model.paging.canShowMore ? "w-auto flex-none px-2" : "flex-1 pr-2 pl-8",
                        )}
                        onClick={() => actions.showLess(model.paging.effectiveExtraPages)}
                      >
                        <span>Show less</span>
                      </SidebarMenuButton>
                    ) : null}
                  </div>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </div>
        </div>
      </div>
    </SidebarGroup>
  );
}
