// FILE: SidebarDesktopUpdateControls.tsx
// Purpose: Render desktop update warning and footer action from the sidebar update owner.
// Layer: Web sidebar presentation

import { TriangleAlertIcon } from "~/lib/icons";
import type { SidebarDesktopUpdateOwner } from "../../hooks/useSidebarDesktopUpdateOwner";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { SidebarGroup } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SidebarDesktopUpdateWarning({
  model,
}: {
  model: SidebarDesktopUpdateOwner["warning"];
}) {
  if (!model.visible || !model.description) return null;
  return (
    <SidebarGroup className="px-2 pt-2 pb-0">
      <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8">
        <TriangleAlertIcon />
        <AlertTitle>Intel build on Apple Silicon</AlertTitle>
        <AlertDescription>{model.description}</AlertDescription>
        {model.actionVisible ? (
          <AlertAction>
            <Button size="xs" variant="outline" disabled={model.disabled} onClick={model.onAction}>
              {model.actionLabel}
            </Button>
          </AlertAction>
        ) : null}
      </Alert>
    </SidebarGroup>
  );
}

export function SidebarDesktopUpdateButton({
  model,
}: {
  model: SidebarDesktopUpdateOwner["button"];
}) {
  if (!model.visible) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={model.tooltip}
            aria-disabled={model.disabled || undefined}
            disabled={model.disabled}
            className={model.className}
            onClick={model.onAction}
          >
            <span className="flex min-w-0 flex-1 items-center justify-between gap-1.5 leading-tight">
              <span className="min-w-0 truncate text-center">{model.label}</span>
              {model.secondaryLabel ? (
                <span className="min-w-0 truncate text-center text-[length:var(--app-font-size-ui-xs,10px)] text-white/80">
                  {model.secondaryLabel}
                </span>
              ) : null}
            </span>
            {model.downloadPercent !== null ? (
              <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-white/95">
                {model.downloadPercent}%
              </span>
            ) : null}
          </button>
        }
      />
      <TooltipPopup side="top">{model.tooltip}</TooltipPopup>
    </Tooltip>
  );
}
