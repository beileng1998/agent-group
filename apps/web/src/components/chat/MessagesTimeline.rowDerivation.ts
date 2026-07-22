// FILE: MessagesTimeline.rowDerivation.ts
// Purpose: Derives ordered transcript rows and folds settled turns for presentation.
// Layer: Web chat presentation helpers

import type { TurnId } from "@agent-group/contracts";
import { formatElapsed, type WorkLogEntry } from "../../session-logic";
import {
  computeMessageDurationStart,
  deriveTerminalAssistantMessageIds,
} from "./MessagesTimeline.messagePresentation";
import { mergeTurnDiffSummaries } from "./MessagesTimeline.turnDiffs";
import type {
  CollapsedTurnItem,
  DeriveMessagesTimelineRowsInput,
  MessagesTimelineRow,
} from "./MessagesTimeline.types";

// Derives transcript rows from timeline entries while keeping live narration and
// tool rows in visual chronology. Work already waiting when assistant text
// arrives renders above that text; trailing work renders below it.
export function deriveMessagesTimelineRows(
  input: DeriveMessagesTimelineRowsInput,
): MessagesTimelineRow[] {
  const nextRows: MessagesTimelineRow[] = [];
  const timelineMessages = input.timelineEntries.flatMap((entry) =>
    entry.kind === "message" ? [entry.message] : [],
  );
  const durationStartByMessageId = computeMessageDurationStart(timelineMessages);
  const terminalAssistantMessageIds = deriveTerminalAssistantMessageIds(timelineMessages);
  let pendingWorkGroup: Extract<MessagesTimelineRow, { kind: "work" }> | null = null;

  const groupedEntriesEqual = (
    left: ReadonlyArray<WorkLogEntry>,
    right: ReadonlyArray<WorkLogEntry>,
  ) => left.length === right.length && left.every((entry, index) => entry === right[index]);

  const appendWorkEntriesToPreviousAssistant = (
    groupedEntries: WorkLogEntry[],
    groupId: string,
  ): boolean => {
    const previousRow = nextRows.at(-1);
    if (
      !previousRow ||
      previousRow.kind !== "message" ||
      previousRow.message.role !== "assistant"
    ) {
      return false;
    }

    const nextInlineWorkEntries = previousRow.inlineWorkEntries
      ? [...previousRow.inlineWorkEntries, ...groupedEntries]
      : groupedEntries;

    if (groupedEntriesEqual(previousRow.inlineWorkEntries ?? [], nextInlineWorkEntries)) {
      return true;
    }

    previousRow.inlineWorkEntries = nextInlineWorkEntries;
    previousRow.inlineWorkGroupId ??= groupId;
    return true;
  };

  const flushPendingWorkGroup = (options?: { attachToPreviousAssistant?: boolean }) => {
    if (!pendingWorkGroup) return;
    const shouldAttachToPreviousAssistant = options?.attachToPreviousAssistant ?? true;
    if (
      !shouldAttachToPreviousAssistant ||
      !appendWorkEntriesToPreviousAssistant(pendingWorkGroup.groupedEntries, pendingWorkGroup.id)
    ) {
      nextRows.push(pendingWorkGroup);
    }
    pendingWorkGroup = null;
  };

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    if (timelineEntry.kind === "work") {
      const groupedEntries = [timelineEntry.entry];
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (!nextEntry || nextEntry.kind !== "work") break;
        groupedEntries.push(nextEntry.entry);
        cursor += 1;
      }
      flushPendingWorkGroup();
      pendingWorkGroup = {
        kind: "work",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        groupedEntries,
      };
      index = cursor - 1;
      continue;
    }

    if (timelineEntry.kind === "proposed-plan") {
      // A plan card is a visible mid-turn artifact. Keep adjacent work as its
      // own row so final turn collapse can preserve the true chronology.
      flushPendingWorkGroup({ attachToPreviousAssistant: false });
      nextRows.push({
        kind: "proposed-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      });
      continue;
    }

    const leadingWorkEntries =
      timelineEntry.message.role === "assistant" ? pendingWorkGroup?.groupedEntries : undefined;
    const leadingWorkGroupId =
      timelineEntry.message.role === "assistant" ? pendingWorkGroup?.id : undefined;
    if (timelineEntry.message.role === "assistant") {
      pendingWorkGroup = null;
    } else {
      flushPendingWorkGroup();
    }

    const assistantTurnStillInProgress =
      timelineEntry.message.role === "assistant" &&
      input.activeTurnInProgress === true &&
      input.activeTurnId != null &&
      timelineEntry.message.turnId === input.activeTurnId;

    nextRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      ...(leadingWorkEntries ? { leadingWorkEntries } : {}),
      ...(leadingWorkGroupId ? { leadingWorkGroupId } : {}),
      durationStart:
        durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt,
      showAssistantCopyButton:
        timelineEntry.message.role === "assistant" &&
        terminalAssistantMessageIds.has(timelineEntry.message.id),
      assistantCopyStreaming: timelineEntry.message.streaming || assistantTurnStillInProgress,
      assistantTurnInProgress: assistantTurnStillInProgress,
      assistantTurnDiffSummary:
        timelineEntry.message.role === "assistant"
          ? input.turnDiffSummaryByAssistantMessageId.get(timelineEntry.message.id)
          : undefined,
      revertTurnCount:
        timelineEntry.message.role === "user"
          ? input.revertTurnCountByUserMessageId.get(timelineEntry.message.id)
          : undefined,
    });
  }

  // Keep any trailing work summary visually attached to the last answer so a
  // completed chat does not end with a detached tool-log footer.
  flushPendingWorkGroup();

  if (input.worktreeSetup) {
    nextRows.push({
      kind: "worktree-setup",
      id: "worktree-setup-row",
      steps: input.worktreeSetup.steps,
      open: input.worktreeSetupOpen,
    });
  }

  // The generic Thinking shimmer remains the single live status. Provider work
  // rows are transcript history and must never replace it.
  if (input.isWorking && !(input.worktreeSetup && input.worktreeSetupOpen)) {
    nextRows.push({
      kind: "working",
      id: "working-indicator-row",
      createdAt: input.activeTurnStartedAt,
    });
  }

  collapseSettledTurns(nextRows, {
    terminalAssistantMessageIds,
    activeTurnInProgress: input.activeTurnInProgress ?? false,
    activeTurnId: input.activeTurnId ?? null,
  });

  // The live turn wears a "Working for Xs" header + divider — the counting-up
  // twin of a settled turn's "Worked for Xs" disclosure. It anchors to the top
  // of the active turn (right after the user message that opened it) and needs a
  // real start time to count from; the trailing "Thinking" shimmer covers the
  // gap before one exists. Inserted after collapse so folding is untouched.
  if (
    input.isWorking &&
    input.activeTurnStartedAt &&
    !(input.worktreeSetup && input.worktreeSetupOpen)
  ) {
    nextRows.splice(findLiveTurnHeaderInsertIndex(nextRows), 0, {
      kind: "working-header",
      id: "working-header-row",
      createdAt: input.activeTurnStartedAt,
    });
  }

  return nextRows;
}

// The live turn starts at the most recent user message, so its header slots in
// right after it. Absent any user message (degenerate transcripts) the header
// leads the transcript so the "Working for" copy is never lost.
function findLiveTurnHeaderInsertIndex(rows: ReadonlyArray<MessagesTimelineRow>): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.kind === "message" && row.message.role === "user") {
      return index + 1;
    }
  }
  return 0;
}

// Returns the terminal assistant only when it is still the transcript tail.
// A newer user message means the next turn has begun but has not produced text yet.
function findTailTerminalAssistantMessageId(
  rows: ReadonlyArray<MessagesTimelineRow>,
  terminalAssistantMessageIds: ReadonlySet<string>,
): string | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.kind !== "message") {
      continue;
    }
    return row.message.role === "assistant" && terminalAssistantMessageIds.has(row.message.id)
      ? row.message.id
      : null;
  }
  return null;
}

// Post-pass: collapse each *settled* turn's work into a single "Worked for Xs"
// disclosure on the terminal assistant message. Assistant narration remains
// visible: providers can emit the substantive answer before a trailing tool
// call and finish with only a short confirmation. The live turn also stays
// expanded/inline so streaming output is never hidden behind a toggle.
function collapseSettledTurns(
  rows: MessagesTimelineRow[],
  options: {
    terminalAssistantMessageIds: ReadonlySet<string>;
    activeTurnInProgress: boolean;
    activeTurnId: TurnId | null;
  },
): void {
  const { terminalAssistantMessageIds, activeTurnInProgress, activeTurnId } = options;
  const lastTerminalAssistantMessageId = activeTurnInProgress
    ? findTailTerminalAssistantMessageId(rows, terminalAssistantMessageIds)
    : null;

  const collectWorkItems = (entries: ReadonlyArray<WorkLogEntry>, into: CollapsedTurnItem[]) => {
    for (const entry of entries) {
      into.push({ kind: "work", id: entry.id, entry });
    }
  };

  const earliestTimestamp = (a: string, b: string): string => {
    const aMs = Date.parse(a);
    const bMs = Date.parse(b);
    if (Number.isNaN(aMs)) return b;
    if (Number.isNaN(bMs)) return a;
    return bMs < aMs ? b : a;
  };

  for (let pass = rows.length - 1; pass >= 0; pass -= 1) {
    const row = rows[pass]!;
    if (row.kind !== "message" || row.message.role !== "assistant") continue;
    // Only the terminal message of a turn owns the collapsed group.
    if (!terminalAssistantMessageIds.has(row.message.id)) continue;
    // Never collapse the live turn: streaming text or the in-progress turn stays
    // inline so the user sees output as it arrives.
    if (row.message.streaming) continue;
    const turnId = row.message.turnId ?? null;
    const turnIsActive =
      activeTurnInProgress &&
      (activeTurnId != null
        ? (turnId != null && turnId === activeTurnId) ||
          row.message.id === lastTerminalAssistantMessageId
        : row.message.id === lastTerminalAssistantMessageId);
    if (turnIsActive) continue;

    // Scan back to the response boundary. Provider mini-turns can have distinct
    // turnIds inside one assistant answer, so the user message boundary is the
    // stable UI grouping point. Assistant rows participate in timing and donate
    // their attached work, but remain visible in the transcript.
    const responseRowIndices: number[] = [];
    for (let scan = pass - 1; scan >= 0; scan -= 1) {
      const prev = rows[scan]!;
      if (prev.kind === "work") {
        responseRowIndices.push(scan);
        continue;
      }
      if (prev.kind === "message" && prev.message.role === "assistant") {
        responseRowIndices.push(scan);
        continue;
      }
      if (prev.kind === "proposed-plan") {
        // The plan card stays visible while earlier work continues into the
        // terminal message's single "Worked for..." disclosure.
        continue;
      }
      break;
    }
    responseRowIndices.reverse();

    const collapsedItems: CollapsedTurnItem[] = [];
    const standaloneWorkIndices: number[] = [];
    const precedingAssistantRows: Array<
      Extract<MessagesTimelineRow, { kind: "message" }>
    > = [];
    let mergedTurnDiffSummary = row.assistantTurnDiffSummary;
    // "Worked for" covers the whole response even though its narration stays
    // visible. The terminal row's own durationStart advances past intermediate
    // completed assistant messages, which would otherwise report only the tail.
    let collapsedStart = row.durationStart;
    for (const index of responseRowIndices) {
      const folded = rows[index]!;
      if (folded.kind === "work") {
        collapsedStart = earliestTimestamp(collapsedStart, folded.createdAt);
        collectWorkItems(folded.groupedEntries, collapsedItems);
        standaloneWorkIndices.push(index);
      } else if (folded.kind === "message" && folded.message.role === "assistant") {
        collapsedStart = earliestTimestamp(collapsedStart, folded.durationStart);
        precedingAssistantRows.push(folded);
        if (folded.assistantTurnDiffSummary) {
          mergedTurnDiffSummary = mergeTurnDiffSummaries(
            folded.assistantTurnDiffSummary,
            mergedTurnDiffSummary ?? folded.assistantTurnDiffSummary,
          );
        }
        if (folded.leadingWorkEntries) collectWorkItems(folded.leadingWorkEntries, collapsedItems);
        if (folded.inlineWorkEntries) collectWorkItems(folded.inlineWorkEntries, collapsedItems);
      }
    }
    // The terminal's own work rows are details around the final answer; fold
    // them into the disclosure so completed chats do not end with tool-log rows.
    if (row.leadingWorkEntries) collectWorkItems(row.leadingWorkEntries, collapsedItems);
    if (row.inlineWorkEntries) collectWorkItems(row.inlineWorkEntries, collapsedItems);

    if (collapsedItems.length > 0) {
      const elapsed = formatElapsed(collapsedStart, row.message.completedAt);
      row.collapsedTurnItems = collapsedItems;
      row.collapsedWorkElapsed = elapsed ?? null;
      row.assistantTurnDiffSummary = mergedTurnDiffSummary;
      delete row.leadingWorkEntries;
      delete row.leadingWorkGroupId;
      delete row.inlineWorkEntries;
      delete row.inlineWorkGroupId;

      for (const precedingRow of precedingAssistantRows) {
        delete precedingRow.leadingWorkEntries;
        delete precedingRow.leadingWorkGroupId;
        delete precedingRow.inlineWorkEntries;
        delete precedingRow.inlineWorkGroupId;
        delete precedingRow.assistantTurnDiffSummary;
      }

      for (const index of [...standaloneWorkIndices].sort((a, b) => b - a)) {
        rows.splice(index, 1);
      }
      pass -= standaloneWorkIndices.length;
    }
  }
}
