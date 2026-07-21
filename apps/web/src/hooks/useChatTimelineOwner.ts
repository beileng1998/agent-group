// FILE: useChatTimelineOwner.ts
// Purpose: Own transcript references, navigation, diff, scroll, selection, and markers.
// Layer: Web chat timeline owner

import { MessageId, PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@agent-group/contracts";
import { useCallback, useRef } from "react";

import { addAssistantSelectionToComposer } from "../lib/assistantSelectionComposerTarget";
import { getSidechatCreator } from "../lib/sidechatCreatorRegistry";
import type { TranscriptAssistantSelection } from "../components/chat/chatSelectionActions";
import type { MessagesTimelineController } from "../components/chat/MessagesTimeline";
import { useTranscriptAssistantSelectionAction } from "../components/chat/useTranscriptAssistantSelectionAction";
import { useTranscriptScrollController } from "../components/chat/useTranscriptScrollController";
import { toastManager } from "../components/ui/toast";
import { useChatDeepLinkController } from "./useChatDeepLinkController";
import { useChatTranscriptNavigationController } from "./useChatTranscriptNavigationController";
import { useThreadDiffPresentationModel } from "./useThreadDiffPresentationModel";
import { useThreadReferenceController } from "./useThreadReferenceController";
import { useTranscriptMarkerController } from "./useTranscriptMarkerController";

type ReferenceInput = Parameters<typeof useThreadReferenceController>[0];
type DeepLinkInput = Parameters<typeof useChatDeepLinkController>[0];
type DiffInput = Parameters<typeof useThreadDiffPresentationModel>[0];
type ScrollInput = Parameters<typeof useTranscriptScrollController>[0];
type SelectionInput = Parameters<typeof useTranscriptAssistantSelectionAction>[0];
type MarkerInput = Parameters<typeof useTranscriptMarkerController>[0];
type NavigationInput = Parameters<typeof useChatTranscriptNavigationController>[0];

export interface ChatTimelineOwnerInput {
  readonly thread: {
    readonly id: ScrollInput["threadId"];
    readonly activeId: ReferenceInput["activeThreadId"];
    readonly active: DiffInput["thread"];
    readonly sourceId: ReferenceInput["sourceThreadId"];
    readonly pinnedMessages: ReferenceInput["pinnedMessages"];
    readonly markers: ReferenceInput["threadMarkers"];
    readonly notes: ReferenceInput["threadNotes"];
    readonly projectInstructions: ReferenceInput["projectInstructions"];
    readonly temporarySidechat: boolean;
  };
  readonly route: {
    readonly navigate: ReferenceInput["navigate"];
    readonly messageThreadId: DeepLinkInput["messageThreadId"];
    readonly messageId: DeepLinkInput["messageId"];
    readonly highlightId: DeepLinkInput["highlightId"];
    readonly editorRail: NavigationInput["route"]["editorRail"];
    readonly diffEnvironmentPending: NavigationInput["route"]["diffEnvironmentPending"];
    readonly onOpenTurnDiffPanel: NavigationInput["route"]["onOpenTurnDiffPanel"];
    readonly onOpenHighlights: ReferenceInput["onOpenHighlights"];
  };
  readonly runtime: {
    readonly timelineMessages: DiffInput["timelineMessages"];
    readonly timelineEntries: DiffInput["timelineEntries"];
    readonly workLogEntries: DiffInput["workLogEntries"];
    readonly latestTurnId: DiffInput["latestTurnId"];
    readonly composerStackedChromeHeight: ScrollInput["composerStackedChromeHeight"];
    readonly inactiveSplitPane: boolean;
    readonly pendingUserInputCount: number;
    readonly composerApprovalState: boolean;
  };
  readonly workspace: {
    readonly gitCwd: DiffInput["gitCwd"];
    readonly isGitRepo: DiffInput["isGitRepo"];
    readonly repoRefetchInterval: DiffInput["repoRefetchInterval"];
    readonly activeProjectId: NavigationInput["editor"]["activeProjectId"];
  };
  readonly composer: {
    readonly imagesRef: SelectionInput["composerImagesRef"];
    readonly filesRef: SelectionInput["composerFilesRef"];
    readonly assistantSelectionsRef: SelectionInput["composerAssistantSelectionsRef"];
    readonly addAssistantSelection: SelectionInput["addComposerAssistantSelectionToDraft"];
    readonly scheduleFocus: SelectionInput["scheduleComposerFocus"];
  };
  readonly sidechat: {
    readonly visibleTargetThreadId: ReferenceInput["activeThreadId"];
    readonly creationEnabled: boolean;
  };
  readonly settings: {
    readonly defaultMarkerColor: MarkerInput["defaultColor"];
  };
  readonly actions: {
    readonly isPendingSetupBubbleId: ReferenceInput["isPendingSetupBubbleId"];
    readonly newEditorThread: NavigationInput["editor"]["newThread"];
    readonly openEditorThreadPage: NavigationInput["editor"]["openThreadPage"];
    readonly revertToTurnCount: NavigationInput["checkpoint"]["revertToTurnCount"];
    readonly runProjectScript: NavigationInput["scripts"]["run"];
  };
}

export function useChatTimelineOwner(input: ChatTimelineOwnerInput) {
  const { timelineEntries, timelineMessages } = input.runtime;
  const timelineControllerRef = useRef<MessagesTimelineController | null>(null);
  const isPendingSetupBubbleId = input.actions.isPendingSetupBubbleId;

  const references = useThreadReferenceController({
    activeThreadId: input.thread.activeId,
    sourceThreadId: input.thread.sourceId,
    pinnedMessages: input.thread.pinnedMessages,
    threadMarkers: input.thread.markers,
    threadNotes: input.thread.notes,
    projectInstructions: input.thread.projectInstructions,
    timelineMessages,
    timelineEntries,
    timelineControllerRef,
    navigate: input.route.navigate,
    onOpenHighlights: input.route.onOpenHighlights,
    isPendingSetupBubbleId,
  });

  useChatDeepLinkController({
    activeThreadId: input.thread.activeId,
    routeThreadId: input.thread.id,
    messageThreadId: input.route.messageThreadId,
    messageId: input.route.messageId,
    highlightId: input.route.highlightId,
    timelineEntries,
    threadMarkers: input.thread.markers,
    timelineControllerRef,
    navigate: input.route.navigate,
  });

  const diff = useThreadDiffPresentationModel({
    thread: input.thread.active,
    timelineMessages,
    timelineEntries,
    latestTurnId: input.runtime.latestTurnId,
    workLogEntries: input.runtime.workLogEntries,
    gitCwd: input.workspace.gitCwd,
    isGitRepo: input.workspace.isGitRepo,
    repoRefetchInterval: input.workspace.repoRefetchInterval,
  });

  const scroll = useTranscriptScrollController({
    threadId: input.thread.id,
    activeThreadId: input.thread.activeId,
    composerStackedChromeHeight: input.runtime.composerStackedChromeHeight,
    timelineEntries,
  });

  const startSidechatFromSelection = useCallback(
    async (selection: TranscriptAssistantSelection) => {
      const createSidechat = getSidechatCreator(input.thread.id);
      if (!createSidechat) {
        throw new Error("Open a server-backed main session before starting Side.");
      }
      await createSidechat({ selection });
    },
    [input.thread.id],
  );
  const addSelectionToVisibleSidechat = useCallback(
    (selection: TranscriptAssistantSelection) => {
      const targetThreadId = input.sidechat.visibleTargetThreadId;
      if (!targetThreadId) return;
      const result = addAssistantSelectionToComposer(targetThreadId, selection);
      if (result === "limit") {
        toastManager.add({
          type: "warning",
          title: `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} references per message.`,
        });
      }
    },
    [input.sidechat.visibleTargetThreadId],
  );
  const canReferenceAssistantSelection = useCallback(
    (selection: TranscriptAssistantSelection) =>
      !isPendingSetupBubbleId(MessageId.makeUnsafe(selection.assistantMessageId)),
    [isPendingSetupBubbleId],
  );

  const selection = useTranscriptAssistantSelectionAction({
    threadId: input.thread.id,
    enabled:
      Boolean(input.thread.active) &&
      !input.runtime.inactiveSplitPane &&
      input.runtime.pendingUserInputCount === 0 &&
      !input.runtime.composerApprovalState,
    composerImagesRef: input.composer.imagesRef,
    composerFilesRef: input.composer.filesRef,
    composerAssistantSelectionsRef: input.composer.assistantSelectionsRef,
    addComposerAssistantSelectionToDraft: input.composer.addAssistantSelection,
    canReferenceAssistantSelection,
    ...(input.sidechat.visibleTargetThreadId
      ? { onAddToSidechat: addSelectionToVisibleSidechat }
      : {}),
    ...(input.sidechat.creationEnabled && !input.thread.temporarySidechat
      ? { onStartSidechat: startSidechatFromSelection }
      : {}),
    scheduleComposerFocus: input.composer.scheduleFocus,
    onMessagesClickCaptureBase: scroll.onMessagesClickCaptureBase,
    onMessagesPointerCancelBase: scroll.onMessagesPointerCancelBase,
    onMessagesPointerDownBase: scroll.onMessagesPointerDownBase,
    onMessagesPointerUpBase: scroll.onMessagesPointerUpBase,
    onMessagesScrollBase: scroll.onMessagesScrollBase,
    onMessagesTouchEndBase: scroll.onMessagesTouchEndBase,
    onMessagesTouchMoveBase: scroll.onMessagesTouchMoveBase,
    onMessagesTouchStartBase: scroll.onMessagesTouchStartBase,
    onMessagesWheelBase: scroll.onMessagesWheelBase,
  });

  const markers = useTranscriptMarkerController({
    activeThreadId: input.thread.activeId,
    defaultColor: input.settings.defaultMarkerColor,
    pendingSelection: selection.pendingTranscriptSelectionAction,
    threadMarkers: input.thread.markers,
    timelineMessages,
    dismissSelection: selection.dismissTranscriptSelectionAction,
    isPendingSetupBubbleId,
    onMessagesClickCapture: selection.onMessagesClickCapture,
  });

  const navigation = useChatTranscriptNavigationController({
    route: {
      navigate: input.route.navigate,
      threadId: input.thread.id,
      editorRail: input.route.editorRail,
      diffEnvironmentPending: input.route.diffEnvironmentPending,
      onOpenTurnDiffPanel: input.route.onOpenTurnDiffPanel,
    },
    diff: { activeTurnId: diff.activeTurnLiveDiffState.turnId },
    editor: {
      activeProjectId: input.workspace.activeProjectId,
      newThread: input.actions.newEditorThread,
      openThreadPage: input.actions.openEditorThreadPage,
    },
    checkpoint: {
      revertTurnCountByUserMessageId: diff.revertTurnCountByUserMessageId,
      revertToTurnCount: input.actions.revertToTurnCount,
    },
    scripts: { run: input.actions.runProjectScript },
  });

  return {
    timeline: {
      entries: timelineEntries,
      messages: timelineMessages,
      pinnedMessages: input.thread.pinnedMessages,
      markers: input.thread.markers,
      notes: input.thread.notes,
      isEmpty: timelineEntries.length === 0,
      controllerRef: timelineControllerRef,
    },
    references,
    diff,
    scroll,
    selection,
    markers,
    navigation,
  };
}
