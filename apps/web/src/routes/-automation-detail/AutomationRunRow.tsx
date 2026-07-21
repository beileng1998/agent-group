import type { AutomationRun } from "@agent-group/contracts";

import { Button } from "~/components/ui/button";
import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";

import {
  canCancelAutomationRun,
  formatRelativeTime,
  isRowInteractiveEventTarget,
  isTriageRun,
  runResultSummary,
  runStatusLabel,
  RunStatusIndicator,
} from "../-automations.shared";

export function AutomationRunRow({
  run,
  onOpen,
  onCancel,
  onMarkRead,
  onArchive,
}: {
  readonly run: AutomationRun;
  readonly onOpen: (threadId: NonNullable<AutomationRun["threadId"]>) => void;
  readonly onCancel: () => void;
  readonly onMarkRead: (unread: boolean) => void;
  readonly onArchive: (archived: boolean) => void;
}) {
  const active = canCancelAutomationRun(run);
  const archived = run.result?.archivedAt !== null && run.result?.archivedAt !== undefined;
  const triageActionable = run.result !== null || isTriageRun(run);
  const unread = run.result ? run.result.unread : triageActionable;
  const openable = run.threadId != null;
  const open = () => {
    if (run.threadId) onOpen(run.threadId as NonNullable<AutomationRun["threadId"]>);
  };

  return (
    <div
      role={openable ? "button" : undefined}
      tabIndex={openable ? 0 : undefined}
      onClick={openable ? open : undefined}
      onKeyDown={
        openable
          ? (event) => {
              if (isRowInteractiveEventTarget(event.target, event.currentTarget)) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                open();
              }
            }
          : undefined
      }
      className={cn(
        "group flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs transition-colors",
        openable ? "cursor-pointer hover:bg-foreground/[0.03]" : undefined,
      )}
    >
      <RunStatusIndicator status={run.status} />
      <div className="min-w-0 flex-1 truncate">
        <span className="text-foreground/90">{runStatusLabel(run.status)}</span>
        <span className="text-muted-foreground"> · {runResultSummary(run)}</span>
      </div>
      {triageActionable ? (
        <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onMarkRead(!unread);
            }}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            {unread ? "Read" : "Unread"}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onArchive(!archived);
            }}
            title={
              run.permissionSnapshot.worktreeMode === "local"
                ? undefined
                : "Archiving does not remove generated worktrees or branches."
            }
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            {archived ? "Unarchive" : "Archive"}
          </button>
        </div>
      ) : null}
      {active ? (
        <Button
          type="button"
          size="icon-chip"
          variant="ghost"
          aria-label="Cancel run"
          onClick={(event) => {
            event.stopPropagation();
            onCancel();
          }}
        >
          <CentralIcon name="stop" className="size-3.5" />
        </Button>
      ) : null}
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {formatRelativeTime(run.finishedAt ?? run.startedAt ?? run.scheduledFor)}
      </span>
    </div>
  );
}
