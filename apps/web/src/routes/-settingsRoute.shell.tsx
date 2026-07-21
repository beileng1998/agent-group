// FILE: -settingsRoute.shell.tsx
// Purpose: Own the stable route chrome around the active settings panel.
// Layer: Settings route surface

import type { ReactNode } from "react";

import { APP_VERSION } from "../branding";
import { OpenSourceLicensesDialog } from "../components/OpenSourceLicensesDialog";
import ReleaseHistoryDialog from "../components/ReleaseHistoryDialog";
import { RouteInsetSurface } from "../components/RouteInsetSurface";
import { SidebarHeaderNavigationControls } from "../components/SidebarHeaderNavigationControls";
import {
  CHAT_CONTENT_CARD_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
} from "../components/chat/composerPickerStyles";
import {
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "../components/chat/chatHeaderControls";
import { Button } from "../components/ui/button";
import { RotateCcwIcon } from "../lib/icons";
import { cn } from "../lib/utils";
import { SETTINGS_PAGE_BACKGROUND_CLASS_NAME } from "../settingsPanelStyles";
import type { SettingsSectionId } from "../settingsNavigation";

export interface SettingsRouteShellProps {
  readonly activeSection: SettingsSectionId;
  readonly activeSectionLabel: string;
  readonly activeSectionDescription: string;
  readonly activePanel: ReactNode;
  readonly changedCount: number;
  readonly restoreDefaults: () => void | Promise<void>;
  readonly trafficLightGutterClassName: string;
  readonly releaseHistoryOpen: boolean;
  readonly setReleaseHistoryOpen: (open: boolean) => void;
  readonly openSourceLicensesOpen: boolean;
  readonly setOpenSourceLicensesOpen: (open: boolean) => void;
}

export function SettingsRouteShell({
  activeSection,
  activeSectionLabel,
  activeSectionDescription,
  activePanel,
  changedCount,
  restoreDefaults,
  trafficLightGutterClassName,
  releaseHistoryOpen,
  setReleaseHistoryOpen,
  openSourceLicensesOpen,
  setOpenSourceLicensesOpen,
}: SettingsRouteShellProps) {
  return (
    <div
      className={cn(
        CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
        SETTINGS_PAGE_BACKGROUND_CLASS_NAME,
        CHAT_CONTENT_CARD_CLASS_NAME,
      )}
    >
      <RouteInsetSurface surfaceClassName={SETTINGS_PAGE_BACKGROUND_CLASS_NAME}>
        {/* Companion sidebar trigger so settings is reachable-and-exitable even when the
          sidebar is collapsed (web/mobile have no global Back arrow). Pinned to the
          card's top-left — at the same header height + traffic-light gutter as the
          chat/workspace headers — so the collapsed-state toggle sits by the traffic
          lights instead of floating in the centered settings body. It renders nothing
          while the sidebar is open (SidebarHeaderNavigationControls returns null), so it
          adds no navigation chrome in the common (open) state and never shifts the centered
          content (hence absolute, not a layout-occupying header row). The strip stays a
          drag-region so the Windows frameless window can be moved by its top edge; the
          caption buttons themselves are a separate fixed cluster (see root route). */}
        <div
          className={cn(
            "drag-region absolute inset-x-0 top-0 z-10 flex items-center",
            CHAT_SURFACE_HEADER_PADDING_X_CLASS,
            CHAT_SURFACE_HEADER_HEIGHT_CLASS,
            trafficLightGutterClassName,
          )}
        >
          <div className="pointer-events-auto">
            <SidebarHeaderNavigationControls />
          </div>
        </div>
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            {activeSection === "profile" ? (
              // Profile is a self-contained dashboard: it owns its own header (avatar,
              // name, share) so it skips the section title bar, and gets a slightly wider
              // pane than the form sections to fit the heatmap + two-column layout.
              <div className="mx-auto w-full max-w-3xl px-6 py-8">{activePanel}</div>
            ) : (
              <div className="mx-auto w-full max-w-2xl px-6 py-8">
                <div className="mb-8 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h1 className="text-xl font-medium tracking-tight text-foreground">
                      {activeSectionLabel}
                    </h1>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {activeSectionDescription}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    className="shrink-0"
                    disabled={changedCount === 0}
                    onClick={() => void restoreDefaults()}
                  >
                    <RotateCcwIcon className="size-3.5" />
                    Restore defaults
                  </Button>
                </div>

                {activePanel}
              </div>
            )}
          </div>
        </div>
        {/* Mounted at the route level (outside the scrollable panel) so the
          dialog portal can overlay the entire settings view without being
          clipped by the content wrapper's overflow. */}
        <ReleaseHistoryDialog
          open={releaseHistoryOpen}
          onOpenChange={setReleaseHistoryOpen}
          defaultExpandedVersion={APP_VERSION}
        />
        <OpenSourceLicensesDialog
          open={openSourceLicensesOpen}
          onOpenChange={setOpenSourceLicensesOpen}
        />
      </RouteInsetSurface>
    </div>
  );
}
