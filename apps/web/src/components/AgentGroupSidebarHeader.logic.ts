import { DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS } from "~/hooks/useDesktopTopBarGutter";
import { cn } from "~/lib/utils";

const AGENT_GROUP_SIDEBAR_HEADER_BASE_CLASS_NAME =
  "drag-region flex h-12 shrink-0 items-center gap-2 px-3";

export function agentGroupSidebarHeaderClassName(input: {
  readonly isElectron: boolean;
  readonly isMacDesktop: boolean;
}): string {
  return cn(
    AGENT_GROUP_SIDEBAR_HEADER_BASE_CLASS_NAME,
    input.isElectron && input.isMacDesktop && DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS,
  );
}
