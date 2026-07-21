import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "~/components/chat/chatHeaderControls";
import { Button } from "~/components/ui/button";
import { useDesktopTopBarWindowControlsGutterClassName } from "~/hooks/useDesktopTopBarGutter";
import { canPauseAutomation } from "~/lib/automationStatus";
import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";

import { AutomationApprovalBanner } from "../-automations.shared";
import { AutomationDefinitionDetails } from "./AutomationDefinitionDetails";
import { DetailGroup, DetailRow, StatusValue } from "./AutomationDetailControls";
import { AutomationRunRow } from "./AutomationRunRow";
import { formatRunTimestamp } from "./automationDetailValues";
import type { LoadedAutomationDetailController } from "./useAutomationDetailController";

export function AutomationDetailSidebar({
  controller,
}: {
  readonly controller: LoadedAutomationDetailController;
}) {
  const desktopTopBarWindowControlsGutterClassName =
    useDesktopTopBarWindowControlsGutterClassName();
  const { definition, approvalGaps, lastRun, runs, status } = controller;

  return (
    <div className="flex min-h-0 w-80 shrink-0 flex-col overflow-hidden">
      <header
        className={cn(
          CHAT_SURFACE_HEADER_PADDING_X_CLASS,
          CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
          "drag-region",
          desktopTopBarWindowControlsGutterClassName,
        )}
      >
        <div
          className={cn(
            "flex items-center justify-end gap-2 sm:gap-3",
            CHAT_SURFACE_HEADER_HEIGHT_CLASS,
          )}
        >
          <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
            {canPauseAutomation(definition) ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={definition.enabled ? "Pause" : "Resume"}
                title={definition.enabled ? "Pause" : "Resume"}
                onClick={controller.togglePause}
              >
                <CentralIcon name={definition.enabled ? "pause" : "play"} className="size-4" />
              </Button>
            ) : null}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Delete"
              title="Delete"
              onClick={() => void controller.deleteDefinition()}
            >
              <CentralIcon name="trash-can-simple" className="size-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              className="ml-1.5"
              disabled={
                controller.runNowPending ||
                controller.updatePending ||
                approvalGaps.runBlockingWarnings.length > 0
              }
              title={
                approvalGaps.runBlockingWarnings.length > 0
                  ? "Approve the automation first"
                  : undefined
              }
              onClick={controller.runNow}
            >
              <CentralIcon name="play" className="size-4" />
              Run now
            </Button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-l border-[var(--app-surface-divider)]">
        <div className="flex flex-col gap-6 px-4 py-8">
          <AutomationApprovalBanner
            warnings={approvalGaps.warnings}
            busy={controller.approvalBusy}
            onApprove={() => void controller.approve().catch(() => undefined)}
            onApproveAndRun={() => void controller.approveAndRunNow()}
          />
          <DetailGroup title="Status">
            <DetailRow label="Status">
              <StatusValue>
                <span className={cn("size-1.5 rounded-full", status.dotClassName)} />
                {status.label}
              </StatusValue>
            </DetailRow>
            <DetailRow label="Next run">
              {definition.enabled && definition.nextRunAt ? (
                <StatusValue tone="muted">{formatRunTimestamp(definition.nextRunAt)}</StatusValue>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Last ran">
              {lastRun ? (
                <StatusValue tone="muted">
                  {formatRunTimestamp(lastRun.finishedAt ?? lastRun.startedAt)}
                </StatusValue>
              ) : (
                "—"
              )}
            </DetailRow>
          </DetailGroup>

          <AutomationDefinitionDetails controller={controller} />

          <DetailGroup title="Previous runs">
            {runs.length === 0 ? (
              <div className="px-1.5 py-1 text-xs text-muted-foreground">No runs yet.</div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {runs.map((run) => (
                  <AutomationRunRow
                    key={run.id}
                    run={run}
                    onOpen={controller.navigateToThread}
                    onCancel={() => controller.cancelRun(run)}
                    onMarkRead={(unread) => controller.markRunRead(run, unread)}
                    onArchive={(archived) => controller.archiveRun(run, archived)}
                  />
                ))}
              </div>
            )}
          </DetailGroup>
        </div>
      </div>
    </div>
  );
}
