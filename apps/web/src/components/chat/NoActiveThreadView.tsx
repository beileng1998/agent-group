import { isElectron } from "../../env";
import {
  useDesktopTopBarTrafficLightGutterClassName,
  useDesktopTopBarWindowControlsGutterClassName,
} from "~/hooks/useDesktopTopBarGutter";
import { cn } from "~/lib/utils";

import { SidebarHeaderNavigationControls } from "../SidebarHeaderNavigationControls";
import { SidebarHeaderTrigger } from "../ui/sidebar";
import { CHAT_BACKGROUND_CLASS_NAME } from "./composerPickerStyles";
import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_ROW_CLASS_NAME,
} from "./chatHeaderControls";

export function NoActiveThreadView() {
  const desktopTopBarTrafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();
  const desktopTopBarWindowControlsGutterClassName =
    useDesktopTopBarWindowControlsGutterClassName();

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col text-[var(--color-text-foreground-secondary)]",
        CHAT_BACKGROUND_CLASS_NAME,
      )}
    >
      {!isElectron && (
        <header className={cn(CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME, "px-3 py-2 md:hidden")}>
          <div className="flex items-center gap-2">
            <SidebarHeaderTrigger className="size-7 shrink-0" />
            <span className="text-sm font-medium text-[var(--color-text-foreground)]">Threads</span>
          </div>
        </header>
      )}
      {isElectron && (
        <div
          className={cn(
            CHAT_SURFACE_HEADER_ROW_CLASS_NAME,
            "drag-region px-5",
            desktopTopBarTrafficLightGutterClassName,
            desktopTopBarWindowControlsGutterClassName,
          )}
        >
          <SidebarHeaderNavigationControls />
          <span className="text-xs text-muted-foreground/50">No active thread</span>
        </div>
      )}
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-sm">Select a thread or create a new one to get started.</p>
        </div>
      </div>
    </div>
  );
}
