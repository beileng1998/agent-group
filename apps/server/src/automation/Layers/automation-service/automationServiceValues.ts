import { randomUUID } from "node:crypto";

import {
  AutomationId,
  AutomationRunId,
  CommandId,
  MessageId,
  ThreadId,
  type AutomationDefinition,
  type AutomationRunResult,
  type AutomationRunStatus,
} from "@agent-group/contracts";

import { AutomationServiceError } from "../../Errors.ts";
import { automationRunResultSummary } from "../../runResult.ts";
import type { AutomationThreadEnvironment } from "./automationServiceTypes.ts";

const AUTOMATION_ERROR_MAX_CHARS = 4_000;

const TERMINAL_RUN_STATUSES: ReadonlySet<AutomationRunStatus> = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
  "skipped",
]);

export function isTerminalRunStatus(status: AutomationRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function makeAutomationId(): AutomationId {
  return AutomationId.makeUnsafe(`automation:${randomUUID()}`);
}

export function makeAutomationRunId(): AutomationRunId {
  return AutomationRunId.makeUnsafe(`automation-run:${randomUUID()}`);
}

export function makeAutomationCommandId(runId: AutomationRunId, suffix: string): CommandId {
  return CommandId.makeUnsafe(`automation:${runId}:${suffix}`);
}

export function deriveAutomationRunIds(runId: AutomationRunId) {
  return {
    threadId: ThreadId.makeUnsafe(`automation:${runId}:thread`),
    messageId: MessageId.makeUnsafe(`automation:${runId}:message`),
    threadCreateCommandId: CommandId.makeUnsafe(`automation:${runId}:thread-create`),
    turnStartCommandId: CommandId.makeUnsafe(`automation:${runId}:turn-start`),
  };
}

export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk|pk|ghp|gho|ghs|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(
      /\b(authorization|bearer|token|api[_-]?key|secret|password)\b(\s*[=:]\s*|\s+)\S+/gi,
      "$1=[redacted]",
    );
}

export function errorMessage(cause: unknown): string {
  const raw =
    cause instanceof Error && cause.message.trim().length > 0 ? cause.message : String(cause);
  return redactSecrets(raw).slice(0, AUTOMATION_ERROR_MAX_CHARS);
}

export function recoveryErrorMessage(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (current == null || typeof current !== "object" || !("cause" in current)) break;
    const cause = (current as { readonly cause?: unknown }).cause;
    if (cause == null) break;
    current = cause;
  }
  return errorMessage(current);
}

function resultSummary(value: string | null | undefined, fallback?: string): string | null {
  return automationRunResultSummary(value, fallback);
}

export function resultForRunStatus(
  status: AutomationRunStatus,
  input: { readonly summary?: string | null; readonly now: string },
): AutomationRunResult | null {
  switch (status) {
    case "succeeded":
      return {
        outcome: "unknown",
        summary: resultSummary(input.summary),
        unread: true,
        archivedAt: null,
      };
    case "failed":
    case "interrupted":
    case "cancelled":
    case "waiting-for-approval":
      return {
        outcome: "needs-attention",
        summary: resultSummary(input.summary, "Automation run needs attention."),
        severity: status === "failed" ? "error" : "warning",
        unread: true,
        archivedAt: null,
      };
    case "skipped":
      return {
        outcome: "no-findings",
        summary: resultSummary(input.summary, "Run skipped."),
        severity: "info",
        unread: false,
        archivedAt: input.now,
      };
    case "pending":
    case "claimed":
    case "running":
      return null;
  }
}

export function toServiceError(message: string) {
  return (cause: unknown) => new AutomationServiceError({ message, cause });
}

export function makeAutomationBranchName(definition: AutomationDefinition, runId: AutomationRunId) {
  const nameSlug = definition.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const safeName = nameSlug.length > 0 ? nameSlug : "run";
  const suffix = runId
    .replace(/[^a-z0-9]+/gi, "-")
    .slice(-12)
    .toLowerCase();
  return `automation/${safeName}/${suffix}`;
}

export const localThreadEnvironment: AutomationThreadEnvironment = {
  envMode: "local",
  branch: null,
  worktreePath: null,
  associatedWorktreePath: null,
  associatedWorktreeBranch: null,
  associatedWorktreeRef: null,
};

export const SCHEDULER_LEASE_TTL_MS = 120_000;
