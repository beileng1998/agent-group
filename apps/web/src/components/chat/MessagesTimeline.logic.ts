// FILE: MessagesTimeline.logic.ts
// Purpose: Preserves the public transcript-logic import path after domain extraction.
// Layer: Web chat presentation facade

export {
  computeMessageDurationStart,
  deriveTerminalAssistantMessageIds,
  normalizeCompactToolLabel,
  resolveAssistantMessageCopyState,
  resolveAssistantMessageDisplayText,
} from "./MessagesTimeline.messagePresentation";
export { deriveMessagesTimelineRows } from "./MessagesTimeline.rowDerivation";
export { computeStableMessagesTimelineRows } from "./MessagesTimeline.rowStability";
export { buildTurnDiffSummaryByAssistantMessageId } from "./MessagesTimeline.turnDiffs";
export { MAX_VISIBLE_WORK_LOG_ENTRIES } from "./MessagesTimeline.types";
export type {
  CollapsedTurnItem,
  MessagesTimelineRow,
  StableMessagesTimelineRowsState,
  TimelineDurationMessage,
} from "./MessagesTimeline.types";
