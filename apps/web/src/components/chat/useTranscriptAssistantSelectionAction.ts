// FILE: useTranscriptAssistantSelectionAction.ts
// Purpose: Own the assistant highlight -> floating action -> composer insertion flow for transcript selections.
// Layer: Chat transcript interaction controller

import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@agent-group/contracts";
import {
  useCallback,
  useEffect,
  useState,
  type MutableRefObject,
  type MouseEventHandler,
  type PointerEventHandler,
  type TouchEventHandler,
  type WheelEventHandler,
} from "react";
import { toastManager } from "../ui/toast";
import { type ComposerAssistantSelectionAttachment } from "../../composerDraftStore";
import {
  createAssistantSelectionAttachment,
  getAssistantSelectionValidationError,
} from "../../lib/assistantSelections";
import {
  readTranscriptAssistantSelection,
  resolveTranscriptSelectionActionLayout,
  type TranscriptAssistantSelection,
} from "./chatSelectionActions";

export interface PendingTranscriptSelectionAction {
  selection: TranscriptAssistantSelection;
  left: number;
  top: number;
  placement: "top" | "bottom";
}

interface UseTranscriptAssistantSelectionActionOptions {
  threadId: string;
  enabled: boolean;
  composerImagesRef: MutableRefObject<ReadonlyArray<unknown>>;
  composerFilesRef: MutableRefObject<ReadonlyArray<unknown>>;
  composerAssistantSelectionsRef: MutableRefObject<
    ReadonlyArray<ComposerAssistantSelectionAttachment>
  >;
  addComposerAssistantSelectionToDraft: (
    selection: ComposerAssistantSelectionAttachment,
  ) => boolean;
  canReferenceAssistantSelection?: (selection: TranscriptAssistantSelection) => boolean;
  onAddToSidechat?: (selection: TranscriptAssistantSelection) => void;
  onStartSidechat?: (selection: TranscriptAssistantSelection) => Promise<void> | void;
  scheduleComposerFocus: () => void;
  onMessagesClickCaptureBase: MouseEventHandler<HTMLDivElement>;
  onMessagesPointerDownBase: PointerEventHandler<HTMLDivElement>;
  onMessagesPointerUpBase: PointerEventHandler<HTMLDivElement>;
  onMessagesPointerCancelBase: PointerEventHandler<HTMLDivElement>;
  onMessagesScrollBase: () => void;
  onMessagesWheelBase: WheelEventHandler<HTMLDivElement>;
  onMessagesTouchStartBase: TouchEventHandler<HTMLDivElement>;
  onMessagesTouchMoveBase: TouchEventHandler<HTMLDivElement>;
  onMessagesTouchEndBase: TouchEventHandler<HTMLDivElement>;
}

export function useTranscriptAssistantSelectionAction(
  options: UseTranscriptAssistantSelectionActionOptions,
) {
  const {
    threadId,
    enabled,
    composerImagesRef,
    composerFilesRef,
    composerAssistantSelectionsRef,
    addComposerAssistantSelectionToDraft,
    canReferenceAssistantSelection,
    onAddToSidechat,
    onStartSidechat,
    scheduleComposerFocus,
    onMessagesClickCaptureBase,
    onMessagesPointerDownBase,
    onMessagesPointerUpBase,
    onMessagesPointerCancelBase,
    onMessagesScrollBase,
    onMessagesWheelBase,
    onMessagesTouchStartBase,
    onMessagesTouchMoveBase,
    onMessagesTouchEndBase,
  } = options;
  const [pendingTranscriptSelectionAction, setPendingTranscriptSelectionAction] =
    useState<PendingTranscriptSelectionAction | null>(null);

  const dismissTranscriptSelectionAction = useCallback(() => {
    setPendingTranscriptSelectionAction(null);
  }, []);

  const onMessagesClickCapture = useCallback<MouseEventHandler<HTMLDivElement>>(
    (event) => {
      dismissTranscriptSelectionAction();
      onMessagesClickCaptureBase(event);
    },
    [dismissTranscriptSelectionAction, onMessagesClickCaptureBase],
  );

  const onMessagesPointerDown = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      dismissTranscriptSelectionAction();
      onMessagesPointerDownBase(event);
    },
    [dismissTranscriptSelectionAction, onMessagesPointerDownBase],
  );

  const onMessagesPointerUp = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      onMessagesPointerUpBase(event);
    },
    [onMessagesPointerUpBase],
  );

  const onMessagesPointerCancel = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      dismissTranscriptSelectionAction();
      onMessagesPointerCancelBase(event);
    },
    [dismissTranscriptSelectionAction, onMessagesPointerCancelBase],
  );

  const onMessagesScroll = useCallback(() => {
    dismissTranscriptSelectionAction();
    onMessagesScrollBase();
  }, [dismissTranscriptSelectionAction, onMessagesScrollBase]);

  const onMessagesWheel = useCallback<WheelEventHandler<HTMLDivElement>>(
    (event) => {
      dismissTranscriptSelectionAction();
      onMessagesWheelBase(event);
    },
    [dismissTranscriptSelectionAction, onMessagesWheelBase],
  );

  const onMessagesTouchStart = useCallback<TouchEventHandler<HTMLDivElement>>(
    (event) => {
      dismissTranscriptSelectionAction();
      onMessagesTouchStartBase(event);
    },
    [dismissTranscriptSelectionAction, onMessagesTouchStartBase],
  );

  const onMessagesTouchMove = useCallback<TouchEventHandler<HTMLDivElement>>(
    (event) => {
      dismissTranscriptSelectionAction();
      onMessagesTouchMoveBase(event);
    },
    [dismissTranscriptSelectionAction, onMessagesTouchMoveBase],
  );

  const onMessagesTouchEnd = useCallback<TouchEventHandler<HTMLDivElement>>(
    (event) => {
      onMessagesTouchEndBase(event);
    },
    [onMessagesTouchEndBase],
  );

  const onMessagesMouseUp = useCallback<MouseEventHandler<HTMLDivElement>>(
    (event) => {
      const container = event.currentTarget;
      const clientX = event.clientX;
      const clientY = event.clientY;
      window.requestAnimationFrame(() => {
        if (!enabled || !container) {
          setPendingTranscriptSelectionAction(null);
          return;
        }

        const selectionState = readTranscriptAssistantSelection({ container });
        if (
          !selectionState ||
          (canReferenceAssistantSelection &&
            !canReferenceAssistantSelection(selectionState.selection))
        ) {
          setPendingTranscriptSelectionAction(null);
          return;
        }

        const extraActionCount =
          Number(Boolean(onAddToSidechat)) + Number(Boolean(onStartSidechat));
        const layout = resolveTranscriptSelectionActionLayout({
          selectionRect: selectionState.selectionRect,
          pointer: { x: clientX, y: clientY },
          ...(extraActionCount > 0 ? { actionWidth: 292 + extraActionCount * 100 } : {}),
        });
        setPendingTranscriptSelectionAction({
          selection: selectionState.selection,
          left: layout.left,
          top: layout.top,
          placement: layout.placement,
        });
      });
    },
    [canReferenceAssistantSelection, enabled, onAddToSidechat, onStartSidechat],
  );

  const commitTranscriptAssistantSelection = useCallback(() => {
    const pendingSelection = pendingTranscriptSelectionAction;
    if (!pendingSelection) {
      return;
    }

    if (
      canReferenceAssistantSelection &&
      !canReferenceAssistantSelection(pendingSelection.selection)
    ) {
      setPendingTranscriptSelectionAction(null);
      window.getSelection()?.removeAllRanges();
      return;
    }

    if (
      composerImagesRef.current.length +
        composerFilesRef.current.length +
        composerAssistantSelectionsRef.current.length >=
      PROVIDER_SEND_TURN_MAX_ATTACHMENTS
    ) {
      setPendingTranscriptSelectionAction(null);
      toastManager.add({
        type: "warning",
        title: `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} references per message.`,
      });
      return;
    }

    const nextSelection = createAssistantSelectionAttachment(pendingSelection.selection);
    if (!nextSelection) {
      setPendingTranscriptSelectionAction(null);
      if (getAssistantSelectionValidationError(pendingSelection.selection) === "too-long") {
        toastManager.add({
          type: "warning",
          title: "Selections can be up to 4,000 characters.",
        });
      }
      return;
    }

    const inserted = addComposerAssistantSelectionToDraft(nextSelection);
    setPendingTranscriptSelectionAction(null);
    if (inserted) {
      window.getSelection()?.removeAllRanges();
      scheduleComposerFocus();
    }
  }, [
    addComposerAssistantSelectionToDraft,
    canReferenceAssistantSelection,
    composerAssistantSelectionsRef,
    composerFilesRef,
    composerImagesRef,
    pendingTranscriptSelectionAction,
    scheduleComposerFocus,
  ]);

  const startSidechatFromPendingSelection = useCallback(() => {
    const pendingSelection = pendingTranscriptSelectionAction;
    if (!pendingSelection || !onStartSidechat) {
      return;
    }
    if (
      canReferenceAssistantSelection &&
      !canReferenceAssistantSelection(pendingSelection.selection)
    ) {
      setPendingTranscriptSelectionAction(null);
      window.getSelection()?.removeAllRanges();
      return;
    }
    if (getAssistantSelectionValidationError(pendingSelection.selection) === "too-long") {
      setPendingTranscriptSelectionAction(null);
      toastManager.add({
        type: "warning",
        title: "Selections can be up to 4,000 characters.",
      });
      return;
    }

    setPendingTranscriptSelectionAction(null);
    window.getSelection()?.removeAllRanges();
    void Promise.resolve()
      .then(() => onStartSidechat(pendingSelection.selection))
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not start Side",
          description:
            error instanceof Error ? error.message : "An error occurred while creating Side.",
        });
      });
  }, [canReferenceAssistantSelection, onStartSidechat, pendingTranscriptSelectionAction]);

  const addToSidechatFromPendingSelection = useCallback(() => {
    const pendingSelection = pendingTranscriptSelectionAction;
    if (!pendingSelection || !onAddToSidechat) {
      return;
    }
    if (
      canReferenceAssistantSelection &&
      !canReferenceAssistantSelection(pendingSelection.selection)
    ) {
      setPendingTranscriptSelectionAction(null);
      window.getSelection()?.removeAllRanges();
      return;
    }
    if (getAssistantSelectionValidationError(pendingSelection.selection) === "too-long") {
      setPendingTranscriptSelectionAction(null);
      toastManager.add({
        type: "warning",
        title: "Selections can be up to 4,000 characters.",
      });
      return;
    }

    setPendingTranscriptSelectionAction(null);
    window.getSelection()?.removeAllRanges();
    onAddToSidechat(pendingSelection.selection);
  }, [canReferenceAssistantSelection, onAddToSidechat, pendingTranscriptSelectionAction]);

  useEffect(() => {
    setPendingTranscriptSelectionAction(null);
  }, [threadId]);

  useEffect(() => {
    if (!enabled) {
      setPendingTranscriptSelectionAction(null);
    }
  }, [enabled]);

  useEffect(() => {
    if (!pendingTranscriptSelectionAction) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-transcript-selection-action='true']")
      ) {
        return;
      }
      setPendingTranscriptSelectionAction(null);
    };
    const handleWindowChange = () => {
      setPendingTranscriptSelectionAction(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleWindowChange);
    document.addEventListener("selectionchange", handleWindowChange);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleWindowChange);
      document.removeEventListener("selectionchange", handleWindowChange);
    };
  }, [pendingTranscriptSelectionAction]);

  return {
    pendingTranscriptSelectionAction,
    addToSidechatFromPendingSelection,
    commitTranscriptAssistantSelection,
    startSidechatFromPendingSelection,
    dismissTranscriptSelectionAction,
    onMessagesClickCapture,
    onMessagesMouseUp,
    onMessagesPointerCancel,
    onMessagesPointerDown,
    onMessagesPointerUp,
    onMessagesScroll,
    onMessagesTouchEnd,
    onMessagesTouchMove,
    onMessagesTouchStart,
    onMessagesWheel,
  };
}
