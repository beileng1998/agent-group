// FILE: SidebarChrome.tsx
// Purpose: Render the sidebar host header, settings branch, content shell, and footer.
// Layer: Web sidebar shell component

import { lazy, Suspense, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { SettingsIcon } from "~/lib/icons";
import { DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS } from "~/hooks/useDesktopTopBarGutter";
import { cn } from "~/lib/utils";
import { isElectron } from "../../env";
import { isMacPlatform } from "../../lib/utils";
import type { SidebarDesktopUpdateOwner } from "../../hooks/useSidebarDesktopUpdateOwner";
import type { SettingsSectionId } from "../../settingsNavigation";
import {
  SIDEBAR_HEADER_ROW_CLASS_NAME,
  SIDEBAR_ROW_HOVER_CLASS_NAME,
  SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
  SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME,
} from "../../sidebarRowStyles";
import { CHAT_SURFACE_HEADER_HEIGHT_CLASS } from "../chat/chatHeaderControls";
import { SettingsSidebarNav } from "../SettingsSidebarNav";
import { SidebarLeadingControls } from "../SidebarHeaderNavigationControls";
import { SidebarLeadingIcon } from "../SidebarLeadingIcon";
import { SidebarGlyph } from "../sidebarGlyphs";
import {
  SidebarDesktopUpdateButton,
  SidebarDesktopUpdateWarning,
} from "./SidebarDesktopUpdateControls";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "../ui/sidebar";

const DebugFeatureFlagsMenu = import.meta.env.DEV
  ? lazy(() =>
      import("../DebugFeatureFlagsMenu").then((module) => ({
        default: module.DebugFeatureFlagsMenu,
      })),
    )
  : null;

export type SidebarChromeProps = {
  readonly children: ReactNode;
  readonly model: {
    readonly isOnSettings: boolean;
    readonly activeSettingsSection: SettingsSectionId;
    readonly showDebugFeatureFlagsMenu: boolean;
  };
  readonly actions: {
    readonly backFromSettings: () => void;
  };
  readonly desktopUpdate: SidebarDesktopUpdateOwner;
};

export function SidebarChrome({ children, model, actions, desktopUpdate }: SidebarChromeProps) {
  const navigate = useNavigate();
  const isMacDesktop = typeof navigator !== "undefined" ? isMacPlatform(navigator.platform) : false;

  // Open-sidebar (in-sidebar) and non-electron wordmark clusters share the one
  // SidebarLeadingControls primitive with the closed-state host headers, so the
  // toggle + arrows look identical whether the sidebar is open or collapsed; only
  // the wrapper layout differs per host.
  const titlebarControls = <SidebarLeadingControls className="hidden md:flex" />;
  const headerControls = <SidebarLeadingControls className="ml-auto hidden md:flex" />;
  const wordmark = (
    <div className="flex w-full items-center gap-1.5">
      <SidebarTrigger className="shrink-0 text-muted-foreground/75 hover:text-foreground md:hidden" />
      {headerControls}
    </div>
  );

  return (
    <>
      {isElectron ? (
        <>
          <SidebarHeader
            className={cn(
              "drag-region flex-row items-center gap-2 px-4 py-0 font-system-ui",
              CHAT_SURFACE_HEADER_HEIGHT_CLASS,
              isMacDesktop && DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS,
            )}
          >
            {titlebarControls}
          </SidebarHeader>
        </>
      ) : (
        <SidebarHeader className="gap-3 px-3 py-2.5 font-system-ui sm:gap-2.5 sm:px-4 sm:py-3">
          {wordmark}
        </SidebarHeader>
      )}

      <SidebarContent className="gap-0 font-system-ui">
        <SidebarDesktopUpdateWarning model={desktopUpdate.warning} />
        {model.isOnSettings ? (
          <SidebarGroup className="p-0">
            <SettingsSidebarNav
              activeSection={model.activeSettingsSection}
              onBack={actions.backFromSettings}
              onSelectSection={(section, options) => {
                void navigate({
                  to: "/settings",
                  search: (previous) => ({
                    ...previous,
                    section: section === "general" ? undefined : section,
                    target: options?.target,
                  }),
                });
              }}
            />
          </SidebarGroup>
        ) : (
          children
        )}
      </SidebarContent>

      <SidebarFooter className="gap-2 p-2 font-system-ui">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex flex-col gap-1">
              {DebugFeatureFlagsMenu && model.showDebugFeatureFlagsMenu && !model.isOnSettings ? (
                <Suspense fallback={null}>
                  <DebugFeatureFlagsMenu />
                </Suspense>
              ) : null}
              <div className="flex items-center gap-2">
                {!model.isOnSettings && (
                  <SidebarMenuButton
                    size="sm"
                    className={cn(
                      SIDEBAR_HEADER_ROW_CLASS_NAME,
                      SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
                      SIDEBAR_ROW_HOVER_CLASS_NAME,
                      "flex-1",
                    )}
                    onClick={() => void navigate({ to: "/settings" })}
                  >
                    <SidebarLeadingIcon size="sm" tone={SIDEBAR_ROW_LABEL_TEXT_CLASS_NAME}>
                      <SidebarGlyph icon={SettingsIcon} variant="leading" />
                    </SidebarLeadingIcon>
                    <span>Settings</span>
                  </SidebarMenuButton>
                )}
                <SidebarDesktopUpdateButton model={desktopUpdate.button} />
              </div>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
