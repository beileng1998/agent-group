import type {
  ApprovalRequestId,
  OrchestrationProposedPlanId,
  OrchestrationThreadActivity,
  ProviderKind,
  ThreadId,
  ToolLifecycleItemType,
  TurnId,
  UserInputQuestion,
} from "@agent-group/contracts";
import type { WorkLogToolDetails } from "./lib/toolCallDetails";
import type { ChatMessage, ProposedPlan } from "./types";

export type ProviderPickerKind = ProviderKind;

export const PROVIDER_OPTIONS: Array<{
  value: ProviderPickerKind;
  label: string;
  available: boolean;
}> = [
  { value: "codex", label: "Codex", available: true },
  { value: "claudeAgent", label: "Claude", available: true },
  { value: "cursor", label: "Cursor", available: true },
  { value: "antigravity", label: "Antigravity", available: true },
  { value: "grok", label: "Grok", available: true },
  { value: "droid", label: "Droid", available: true },
  { value: "kilo", label: "Kilo", available: true },
  { value: "opencode", label: "OpenCode", available: true },
  { value: "pi", label: "Pi", available: true },
];

export interface WorkLogEntry {
  id: string;
  createdAt: string;
  turnId?: TurnId | null;
  label: string;
  detail?: string;
  command?: string;
  rawCommand?: string;
  preview?: string;
  changedFiles?: ReadonlyArray<string>;
  tone: "thinking" | "tool" | "info" | "error";
  toolTitle?: string;
  toolName?: string;
  toolCallId?: string;
  toolDetails?: WorkLogToolDetails;
  itemType?: ToolLifecycleItemType;
  requestKind?: PendingApproval["requestKind"];
  subagents?: ReadonlyArray<WorkLogSubagent>;
  subagentAction?: WorkLogSubagentAction;
  automation?: WorkLogAutomation;
  // Source activity kind, kept so the timeline can pick a kind-specific icon
  // (e.g. user-input.requested -> question glyph) instead of the generic
  // tone fallback. Same rationale as `toolName` below.
  activityKind?: OrchestrationThreadActivity["kind"];
}

// Created-automation rows render as a dedicated card (icon + name + cadence + Open)
// instead of a plain tool-call line, so carry just the fields that card needs.
export interface WorkLogAutomation {
  id: string;
  name: string;
  cadenceLabel: string;
}

export const WORK_LOG_PRESENTATION_VERSION = 6;

export interface WorkLogSubagent {
  threadId: string;
  providerThreadId?: string | undefined;
  resolvedThreadId?: string | undefined;
  agentId?: string | undefined;
  nickname?: string | undefined;
  role?: string | undefined;
  model?: string | undefined;
  prompt?: string | undefined;
  rawStatus?: string | undefined;
  latestUpdate?: string | undefined;
  title?: string | undefined;
  statusLabel?: string | undefined;
  isActive?: boolean | undefined;
}

export interface WorkLogSubagentAction {
  tool: string;
  status: string;
  summaryText: string;
  model?: string | undefined;
  prompt?: string | undefined;
}

export interface DerivedWorkLogEntry extends WorkLogEntry {
  activityKind: OrchestrationThreadActivity["kind"];
  collapseKey?: string;
  collapseCommand?: string;
  toolName?: string;
  runtimeWarningRepeatCount?: number;
  runtimeWarningMessage?: string;
}

export interface PendingApproval {
  requestId: ApprovalRequestId;
  requestKind: "command" | "file-read" | "file-change";
  createdAt: string;
  detail?: string;
}

// Shared edited-file predicates keep transcript cards and composer chrome aligned.
export function isFileChangeWorkLogEntry(
  workEntry: Pick<WorkLogEntry, "itemType" | "requestKind">,
): boolean {
  return workEntry.requestKind === "file-change" || workEntry.itemType === "file_change";
}

export function isProviderFileEditWorkLogEntry(
  workEntry: Pick<WorkLogEntry, "changedFiles" | "itemType" | "requestKind">,
): boolean {
  if (workEntry.itemType === "file_change") return true;
  return workEntry.requestKind === "file-change" && (workEntry.changedFiles?.length ?? 0) > 0;
}

export interface PendingUserInput {
  requestId: ApprovalRequestId;
  createdAt: string;
  questions: ReadonlyArray<UserInputQuestion>;
}

export interface ActiveTaskListState {
  createdAt: string;
  turnId: TurnId | null;
  explanation?: string | null;
  tasks: Array<{
    task: string;
    status: "pending" | "inProgress" | "completed";
  }>;
}

export interface ActiveBackgroundTasksState {
  activeCount: number;
}

export interface LatestProposedPlanState {
  id: OrchestrationProposedPlanId;
  createdAt: string;
  updatedAt: string;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
}

export type TimelineEntry =
  | {
      id: string;
      kind: "message";
      createdAt: string;
      message: ChatMessage;
    }
  | {
      id: string;
      kind: "proposed-plan";
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | {
      id: string;
      kind: "work";
      createdAt: string;
      entry: WorkLogEntry;
    };
