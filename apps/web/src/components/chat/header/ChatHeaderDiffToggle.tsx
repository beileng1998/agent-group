import type { RepoDiffTotals } from "~/hooks/useRepoDiffTotals";
import { PanelRightCloseIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { Toggle } from "../../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { CHAT_HEADER_TOGGLE_CLASS_NAME, SurfaceChipIcon } from "../chatHeaderControls";

export function ChatHeaderDiffToggle(props: {
  visible: boolean;
  isGitRepo: boolean;
  open: boolean;
  disabledReason: string | null;
  shortcutLabel: string | null;
  totals: RepoDiffTotals;
  onToggle: () => void;
}) {
  if (!props.visible) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className={cn(
              CHAT_HEADER_TOGGLE_CLASS_NAME,
              props.totals.hasChanges ? null : "!size-7 [&_svg,&_[data-slot=central-icon]]:mx-0",
            )}
            pressed={props.open}
            onPressedChange={props.onToggle}
            aria-label="Toggle diff panel"
            variant="default"
            size="xs"
            disabled={!props.isGitRepo || (props.disabledReason !== null && !props.open)}
          >
            {props.totals.hasChanges ? (
              <span className="inline-flex items-center gap-1">
                <span className="font-system-ui text-[length:var(--app-font-size-ui-sm,11px)] sm:text-[length:var(--app-font-size-ui-xs,10px)] font-normal tracking-normal tabular-nums text-success">
                  +{props.totals.additions}
                </span>
                <span className="font-system-ui text-[length:var(--app-font-size-ui-sm,11px)] sm:text-[length:var(--app-font-size-ui-xs,10px)] font-normal tracking-normal tabular-nums text-destructive">
                  -{props.totals.deletions}
                </span>
              </span>
            ) : null}
            <SurfaceChipIcon icon={PanelRightCloseIcon} className="size-4" />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">
        {!props.isGitRepo
          ? "Diff panel is unavailable because this project is not a git repository."
          : props.disabledReason && !props.open
            ? props.disabledReason
            : props.shortcutLabel
              ? `Toggle diff panel (${props.shortcutLabel})`
              : "Toggle diff panel"}
      </TooltipPopup>
    </Tooltip>
  );
}
