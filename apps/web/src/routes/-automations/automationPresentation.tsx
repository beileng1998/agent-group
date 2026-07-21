// FILE: automationPresentation.tsx
// Purpose: Shared automation status, triage, and template presentation.
// Layer: Automation web feature

import type {
  AutomationDefinition,
  AutomationRun,
  AutomationRunResult,
} from "@agent-group/contracts";
import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";

export const AUTOMATION_TEMPLATES: readonly {
  readonly label: string;
  readonly name: string;
  readonly prompt: string;
}[] = [
  {
    label: "Triage new crashes",
    name: "Triage crashes",
    prompt: "Look for new crashes in $sentry and open a fix PR for the most impactful one.",
  },
  {
    label: "Update dependencies",
    name: "Update dependencies",
    prompt:
      "Check for outdated dependencies, bump the safe minor and patch versions, then run the tests.",
  },
  {
    label: "Daily standup summary",
    name: "Daily summary",
    prompt:
      "Summarize what changed on the main branch in the last 24 hours as a short standup update.",
  },
];

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w`;
  return `${Math.floor(days / 30)}mo`;
}

export function runStatusVariant(
  status: AutomationRun["status"],
): "success" | "warning" | "error" | "info" | "outline" {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
    case "cancelled":
    case "interrupted":
      return "error";
    case "waiting-for-approval":
    case "skipped":
      return "warning";
    case "running":
    case "claimed":
    case "pending":
      return "info";
  }
}

export function runStatusDotClassName(status: AutomationRun["status"]): string {
  switch (runStatusVariant(status)) {
    case "success":
      return "text-emerald-500";
    case "error":
      return "text-destructive";
    case "warning":
      return "text-amber-500";
    case "info":
      return "text-blue-500";
    case "outline":
      return "text-muted-foreground/50";
  }
}

export function isRowInteractiveEventTarget(
  target: EventTarget | null,
  currentTarget: HTMLElement,
): boolean {
  if (!(target instanceof HTMLElement) || target === currentTarget) {
    return false;
  }
  return Boolean(target.closest("button,a,input,textarea,select,[contenteditable='true']"));
}

export function RunStatusIndicator({
  status,
  className,
}: {
  readonly status: AutomationRun["status"];
  readonly className?: string;
}) {
  if (runStatusVariant(status) === "success") {
    return (
      <CentralIcon
        name="circle-check"
        className={cn("size-3.5 shrink-0 text-muted-foreground/70", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center",
        runStatusDotClassName(status),
        className,
      )}
    >
      <span className="block size-1.5 rounded-full bg-current" />
    </span>
  );
}

export function isTriageRun(run: AutomationRun): boolean {
  if (run.result) {
    return isUnresolvedTriageResult(run.result);
  }
  return (
    run.status === "failed" ||
    run.status === "cancelled" ||
    run.status === "interrupted" ||
    run.status === "waiting-for-approval"
  );
}

export function isUnresolvedTriageResult(result: AutomationRunResult | null): boolean {
  return Boolean(result && result.unread && result.archivedAt === null);
}

export function unresolvedTriageRuns(runs: readonly AutomationRun[]): AutomationRun[] {
  return runs.filter((run) => isTriageRun(run));
}

export function allVisibleTriageRuns(runs: readonly AutomationRun[]): AutomationRun[] {
  return runs.filter((run) => (run.result ? run.result.archivedAt === null : isTriageRun(run)));
}

export function automationAttentionCount(runs: readonly AutomationRun[]): number {
  return unresolvedTriageRuns(runs).length;
}

export function runStatusLabel(status: AutomationRun["status"]): string {
  switch (status) {
    case "pending":
      return "Queued";
    case "claimed":
      return "Starting";
    case "running":
      return "Running";
    case "waiting-for-approval":
      return "Waiting for approval";
    case "succeeded":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "interrupted":
      return "Interrupted";
    case "skipped":
      return "Skipped";
  }
}

export function runResultSummary(run: AutomationRun): string {
  if (run.result?.summary) return run.result.summary;
  if (run.error) return run.error;
  switch (run.result?.outcome) {
    case "findings":
      return "Found something to review";
    case "no-findings":
      return "No findings";
    case "changed-files":
      return "Changed files";
    case "needs-attention":
      return "Needs attention";
    case "unknown":
      return run.threadId ? "Completed; open the thread for the reply" : "Completed";
    case undefined:
      return runStatusLabel(run.status);
  }
}

export function canCancelAutomationRun(run: AutomationRun): boolean {
  return (
    run.status === "pending" ||
    run.status === "claimed" ||
    run.status === "running" ||
    run.status === "waiting-for-approval"
  );
}

export function automationStatusDotClass(
  definition: AutomationDefinition,
  latestRun: AutomationRun | null,
): string {
  if (!definition.enabled) return "text-muted-foreground/40";
  if (
    latestRun?.status === "running" ||
    latestRun?.status === "pending" ||
    latestRun?.status === "claimed"
  ) {
    return "text-blue-500";
  }
  if (latestRun && isTriageRun(latestRun)) return "text-destructive";
  return "text-emerald-500";
}
