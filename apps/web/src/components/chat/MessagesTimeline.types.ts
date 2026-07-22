// FILE: MessagesTimeline.types.ts
// Purpose: Defines transcript row contracts shared by timeline derivation and rendering.
// Layer: Web chat presentation contracts

import type { TimelineEntry, WorkLogEntry } from "../../session-logic";
import type {
  ChatMessage,
  ProposedPlan,
  TurnDiffSummary,
  WorktreeSetupSnapshot,
  WorktreeSetupStep,
} from "../../types";
import type { MessageId, TurnId } from "@agent-group/contracts";

export const MAX_VISIBLE_WORK_LOG_ENTRIES = 6;

// Work item folded into a settled turn's single "Worked for Xs" disclosure.
// Assistant narration always remains visible in the transcript.
export type CollapsedTurnItem = { kind: "work"; id: string; entry: WorkLogEntry };

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  turnId?: string | null;
  completedAt?: string | undefined;
}

export interface TimelineDiffMessage {
  id: MessageId;
  role: "user" | "assistant" | "system";
  turnId: TurnId | null;
}

export type MessagesTimelineRow =
  | {
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: WorkLogEntry[];
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
      leadingWorkEntries?: WorkLogEntry[];
      leadingWorkGroupId?: string;
      inlineWorkEntries?: WorkLogEntry[];
      inlineWorkGroupId?: string;
      collapsedTurnItems?: CollapsedTurnItem[];
      collapsedWorkElapsed?: string | null;
      durationStart: string;
      showAssistantCopyButton: boolean;
      assistantCopyStreaming: boolean;
      assistantTurnDiffSummary?: TurnDiffSummary | undefined;
      // True while this row's turn is still running. The end-of-turn changes
      // card (Undo / Review) is held back until the turn settles so it cannot
      // pre-empt the composer's live changes strip mid-turn.
      assistantTurnInProgress?: boolean | undefined;
      revertTurnCount?: number | undefined;
    }
  | {
      kind: "proposed-plan";
      id: string;
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | { kind: "working"; id: string; createdAt: string | null }
  | {
      // Live-turn header that mirrors the settled "Worked for Xs" disclosure
      // (label + full-width divider), but is non-collapsible and counts up while
      // the turn is still running. Sits at the top of the active turn.
      kind: "working-header";
      id: string;
      createdAt: string;
    }
  | {
      // Transient "Preparing worktree..." step card shown during the New
      // worktree first-send setup. `open` drives the shared disclosure close
      // animation while the presentation hook keeps the row mounted.
      kind: "worktree-setup";
      id: string;
      steps: ReadonlyArray<WorktreeSetupStep>;
      open: boolean;
    };

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

export interface DeriveMessagesTimelineRowsInput {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  isWorking: boolean;
  worktreeSetup: WorktreeSetupSnapshot | null;
  worktreeSetupOpen: boolean;
  activeTurnInProgress?: boolean;
  activeTurnId?: TurnId | null | undefined;
  activeTurnStartedAt: string | null;
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, TurnDiffSummary>;
  revertTurnCountByUserMessageId: ReadonlyMap<MessageId, number>;
}
