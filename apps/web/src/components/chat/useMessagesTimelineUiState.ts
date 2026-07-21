// FILE: useMessagesTimelineUiState.ts
// Purpose: Own local transcript disclosure, edit, marker, and tool-dialog state.
// Layer: Web chat timeline controller

import type { MessageId, ThreadMarker, TurnId } from "@agent-group/contracts";
import { resolveLatestTailUserMessageEditTarget } from "@agent-group/shared/conversationEdit";
import { useCallback, useMemo, useState } from "react";
import { findToolDetailsEntryById } from "./MessagesTimeline.controllers";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import type { TimelineWorkEntry } from "./MessagesTimeline.workEntryModel";

const EMPTY_THREAD_MARKERS_BY_MESSAGE_ID = new Map<MessageId, readonly ThreadMarker[]>();

interface UseMessagesTimelineUiStateInput {
  activeTurnId?: TurnId | null;
  expandedWorkGroups?: Record<string, boolean>;
  onEditUserMessage?: (messageId: MessageId, text: string) => boolean | Promise<boolean>;
  onToggleWorkGroup?: (groupId: string) => void;
  rows: readonly MessagesTimelineRow[];
  threadMarkers: readonly ThreadMarker[];
}

export function useMessagesTimelineUiState({
  activeTurnId,
  expandedWorkGroups,
  onEditUserMessage,
  onToggleWorkGroup,
  rows,
  threadMarkers,
}: UseMessagesTimelineUiStateInput) {
  const [localExpandedWorkGroups, setLocalExpandedWorkGroups] = useState<Record<string, boolean>>(
    {},
  );
  const [expandedCollapsedWork, setExpandedCollapsedWork] = useState<Record<string, boolean>>({});
  const [expandedFileChangesByTurnId, setExpandedFileChangesByTurnId] = useState<
    Record<string, boolean>
  >({});
  const [expandedFileListByTurnId, setExpandedFileListByTurnId] = useState<Record<string, boolean>>(
    {},
  );
  const [expandedUserMessagesById, setExpandedUserMessagesById] = useState<Record<string, boolean>>(
    {},
  );
  const [editingUserMessageId, setEditingUserMessageId] = useState<MessageId | null>(null);
  const [submittingEditedUserMessageId, setSubmittingEditedUserMessageId] =
    useState<MessageId | null>(null);
  const [selectedToolDetailsEntryId, setSelectedToolDetailsEntryId] = useState<string | null>(null);

  const expandedWorkGroupsState = expandedWorkGroups ?? localExpandedWorkGroups;
  const handleToggleWorkGroup = useCallback(
    (groupId: string) => {
      if (onToggleWorkGroup) {
        onToggleWorkGroup(groupId);
        return;
      }
      setLocalExpandedWorkGroups((current) => ({
        ...current,
        [groupId]: !(current[groupId] ?? false),
      }));
    },
    [onToggleWorkGroup],
  );
  const setCollapsedWorkExpanded = useCallback((messageId: string, open: boolean) => {
    setExpandedCollapsedWork((current) => ({ ...current, [messageId]: open }));
  }, []);
  const toggleFileChangesExpanded = useCallback((turnId: TurnId) => {
    setExpandedFileChangesByTurnId((current) => ({
      ...current,
      [turnId]: !(current[turnId] ?? true),
    }));
  }, []);
  const toggleFileListExpanded = useCallback((turnId: TurnId) => {
    setExpandedFileListByTurnId((current) => ({
      ...current,
      [turnId]: !(current[turnId] ?? false),
    }));
  }, []);
  const cancelUserMessageEdit = useCallback(() => setEditingUserMessageId(null), []);
  const startUserMessageEdit = useCallback(
    (messageId: MessageId) => setEditingUserMessageId(messageId),
    [],
  );
  const submitUserMessageEdit = useCallback(
    async (messageId: MessageId, text: string) => {
      if (!onEditUserMessage) return;
      const nextText = text.trim();
      if (!nextText) return;
      setSubmittingEditedUserMessageId(messageId);
      try {
        const saved = await onEditUserMessage(messageId, nextText);
        if (saved) cancelUserMessageEdit();
      } finally {
        setSubmittingEditedUserMessageId(null);
      }
    },
    [cancelUserMessageEdit, onEditUserMessage],
  );
  const openToolDetails = useCallback((workEntry: TimelineWorkEntry) => {
    setSelectedToolDetailsEntryId(workEntry.id);
  }, []);
  const handleToolDetailsOpenChange = useCallback((open: boolean) => {
    if (!open) setSelectedToolDetailsEntryId(null);
  }, []);

  const threadMarkersByMessageId = useMemo<ReadonlyMap<MessageId, readonly ThreadMarker[]>>(() => {
    if (threadMarkers.length === 0) return EMPTY_THREAD_MARKERS_BY_MESSAGE_ID;
    const byMessageId = new Map<MessageId, ThreadMarker[]>();
    for (const marker of threadMarkers) {
      const markers = byMessageId.get(marker.messageId);
      if (markers) markers.push(marker);
      else byMessageId.set(marker.messageId, [marker]);
    }
    return byMessageId;
  }, [threadMarkers]);
  const latestEditableUserMessageId = useMemo(() => {
    const messages = rows.flatMap((row) => (row.kind === "message" ? [row.message] : []));
    const target = resolveLatestTailUserMessageEditTarget({ messages, activeTurnId });
    return target.editable ? (target.messageId as MessageId) : null;
  }, [activeTurnId, rows]);
  const selectedToolDetailsEntry = useMemo(
    () => findToolDetailsEntryById(rows, selectedToolDetailsEntryId),
    [rows, selectedToolDetailsEntryId],
  );

  return {
    cancelUserMessageEdit,
    editingUserMessageId,
    expandedCollapsedWork,
    expandedFileChangesByTurnId,
    expandedFileListByTurnId,
    expandedUserMessagesById,
    expandedWorkGroupsState,
    handleToggleWorkGroup,
    handleToolDetailsOpenChange,
    latestEditableUserMessageId,
    openToolDetails,
    selectedToolDetailsEntry,
    setCollapsedWorkExpanded,
    setExpandedUserMessagesById,
    startUserMessageEdit,
    submitUserMessageEdit,
    submittingEditedUserMessageId,
    threadMarkersByMessageId,
    toggleFileChangesExpanded,
    toggleFileListExpanded,
  };
}
