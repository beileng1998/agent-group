// FILE: useComposerDraftReferencesController.ts
// Purpose: Own composer attachments, reference cards, persistence, and drop entry points.
// Layer: Web composer controller

import { type ThreadId } from "@agent-group/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  type ComposerAssistantSelectionAttachment,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type ComposerPromptHistorySavedDraft,
  useComposerDraftStore,
} from "../composerDraftStore";
import type { ComposerPromptEditorHandle } from "../components/ComposerPromptEditor";
import { stagePersistedComposerImageAttachments } from "../components/chat/chatViewAttachmentHandoff";
import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  type ComposerTrigger,
} from "../composer-logic";
import {
  buildComposerFileAttachmentsFromFiles,
  buildComposerImageAttachmentsFromFiles,
  effectiveComposerAttachmentCount,
} from "../lib/composerSend";
import { useComposerDropzone } from "./useComposerDropzone";
import { appendComposerPromptText } from "../lib/chatReferences";
import { formatComposerMentionToken } from "../lib/composerMentions";
import { createPastedTextDraft, type PastedTextDraft } from "../lib/composerPastedText";
import type { FileCommentDraft } from "../lib/fileComments";
import {
  insertInlineTerminalContextPlaceholder,
  removeInlineTerminalContextPlaceholder,
  type TerminalContextDraft,
  type TerminalContextSelection,
} from "../lib/terminalContext";
import { randomUUID } from "../lib/utils";
import { toastManager } from "../components/ui/toast";

export function useComposerDraftReferencesController(input: {
  threadId: ThreadId;
  activeThreadId: ThreadId | null;
  pendingUserInputCount: number;
  images: readonly ComposerImageAttachment[];
  files: readonly ComposerFileAttachment[];
  assistantSelections: readonly ComposerAssistantSelectionAttachment[];
  terminalContexts: readonly TerminalContextDraft[];
  fileComments: readonly FileCommentDraft[];
  pastedTexts: readonly PastedTextDraft[];
  promptHistorySavedDraft: ComposerPromptHistorySavedDraft | null;
  nonPersistedImageIds: readonly string[];
  persistedAttachments: readonly { id: string; blobKey?: string | null }[];
  promptRef: MutableRefObject<string>;
  editorRef: MutableRefObject<ComposerPromptEditorHandle | null>;
  composerCursor: number;
  dragDepthRef: MutableRefObject<number>;
  discardPromptHistory: () => void;
  setPrompt: (prompt: string) => void;
  setComposerCursor: (cursor: number) => void;
  setComposerTrigger: (trigger: ComposerTrigger | null) => void;
  setThreadError: (threadId: ThreadId, error: string | null) => void;
  focusComposer: () => void;
  setIsDragOverComposer: Dispatch<SetStateAction<boolean>>;
}) {
  const imagesRef = useRef<ComposerImageAttachment[]>([...input.images]);
  const filesRef = useRef<ComposerFileAttachment[]>([...input.files]);
  const assistantSelectionsRef = useRef<ComposerAssistantSelectionAttachment[]>([
    ...input.assistantSelections,
  ]);
  const terminalContextsRef = useRef<TerminalContextDraft[]>([...input.terminalContexts]);
  const fileCommentsRef = useRef<FileCommentDraft[]>([...input.fileComments]);
  const pastedTextsRef = useRef<PastedTextDraft[]>([...input.pastedTexts]);

  useEffect(() => void (imagesRef.current = [...input.images]), [input.images]);
  useEffect(() => void (filesRef.current = [...input.files]), [input.files]);
  useEffect(
    () => void (assistantSelectionsRef.current = [...input.assistantSelections]),
    [input.assistantSelections],
  );
  useEffect(
    () => void (terminalContextsRef.current = [...input.terminalContexts]),
    [input.terminalContexts],
  );
  useEffect(() => void (fileCommentsRef.current = [...input.fileComments]), [input.fileComments]);
  useEffect(() => void (pastedTextsRef.current = [...input.pastedTexts]), [input.pastedTexts]);

  const nonPersistedImageIdSet = useMemo(() => {
    const durableBlobIds = new Set(
      input.persistedAttachments
        .filter((attachment) => Boolean(attachment.blobKey))
        .map((attachment) => attachment.id),
    );
    return new Set(input.nonPersistedImageIds.filter((id) => !durableBlobIds.has(id)));
  }, [input.nonPersistedImageIds, input.persistedAttachments]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const store = useComposerDraftStore.getState();
      if (input.images.length === 0) {
        const hasDeferredBlobAttachment =
          store.draftsByThreadId[input.threadId]?.persistedAttachments.some(
            (attachment) => attachment.blobKey,
          ) ?? false;
        if (!hasDeferredBlobAttachment) {
          store.clearPersistedAttachments(input.threadId);
        }
        return;
      }
      const staged = await stagePersistedComposerImageAttachments({
        threadId: input.threadId,
        images: input.images,
        getPersistedAttachments: () =>
          useComposerDraftStore.getState().draftsByThreadId[input.threadId]?.persistedAttachments ??
          [],
      });
      if (!cancelled) {
        void useComposerDraftStore.getState().syncPersistedAttachments(input.threadId, staged);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input.images, input.threadId]);

  useEffect(() => {
    const savedImages = input.promptHistorySavedDraft?.images ?? [];
    if (savedImages.length === 0) return;
    let cancelled = false;
    void (async () => {
      const staged = await stagePersistedComposerImageAttachments({
        threadId: input.threadId,
        images: savedImages,
        getPersistedAttachments: () =>
          useComposerDraftStore.getState().draftsByThreadId[input.threadId]?.promptHistorySavedDraft
            ?.persistedAttachments ?? [],
      });
      if (!cancelled) {
        void useComposerDraftStore
          .getState()
          .syncPromptHistorySavedDraftPersistedAttachments(input.threadId, staged);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input.promptHistorySavedDraft?.images, input.threadId]);

  const mutate = useCallback(
    <T>(operation: (store: ReturnType<typeof useComposerDraftStore.getState>) => T): T => {
      input.discardPromptHistory();
      return operation(useComposerDraftStore.getState());
    },
    [input.discardPromptHistory],
  );

  const addImagesToDraft = useCallback(
    (images: ComposerImageAttachment[]) =>
      mutate((store) => store.addImages(input.threadId, images)),
    [input.threadId, mutate],
  );
  const addFilesToDraft = useCallback(
    (files: ComposerFileAttachment[]) => mutate((store) => store.addFiles(input.threadId, files)),
    [input.threadId, mutate],
  );
  const addAssistantSelectionToDraft = useCallback(
    (selection: ComposerAssistantSelectionAttachment) =>
      mutate((store) => store.addAssistantSelection(input.threadId, selection)),
    [input.threadId, mutate],
  );
  const addTerminalContextsToDraft = useCallback(
    (contexts: TerminalContextDraft[]) =>
      mutate((store) => store.addTerminalContexts(input.threadId, contexts)),
    [input.threadId, mutate],
  );
  const addPastedTextsToDraft = useCallback(
    (texts: PastedTextDraft[]) => mutate((store) => store.addPastedTexts(input.threadId, texts)),
    [input.threadId, mutate],
  );
  const addFileCommentToDraft = useCallback(
    (comment: FileCommentDraft) =>
      void mutate((store) => store.addFileComment(input.threadId, comment)),
    [input.threadId, mutate],
  );
  const removeImage = useCallback(
    (imageId: string) => void mutate((store) => store.removeImage(input.threadId, imageId)),
    [input.threadId, mutate],
  );
  const removeFile = useCallback(
    (fileId: string) => void mutate((store) => store.removeFile(input.threadId, fileId)),
    [input.threadId, mutate],
  );
  const clearAssistantSelections = useCallback(
    () => void mutate((store) => store.clearAssistantSelections(input.threadId)),
    [input.threadId, mutate],
  );
  const clearFileComments = useCallback(
    () => void mutate((store) => store.clearFileComments(input.threadId)),
    [input.threadId, mutate],
  );

  const removeTerminalContext = useCallback(
    (contextId: string) => {
      input.discardPromptHistory();
      const contextIndex = input.terminalContexts.findIndex((context) => context.id === contextId);
      if (contextIndex < 0) return;
      const next = removeInlineTerminalContextPlaceholder(input.promptRef.current, contextIndex);
      input.promptRef.current = next.prompt;
      input.setPrompt(next.prompt);
      useComposerDraftStore.getState().removeTerminalContext(input.threadId, contextId);
      input.setComposerCursor(next.cursor);
      input.setComposerTrigger(
        detectComposerTrigger(next.prompt, expandCollapsedComposerCursor(next.prompt, next.cursor)),
      );
    },
    [input],
  );

  const removePastedText = useCallback(
    (pastedTextId: string) =>
      void mutate((store) => store.removePastedText(input.threadId, pastedTextId)),
    [input.threadId, mutate],
  );
  const showPastedTextInField = useCallback(
    (pastedTextId: string) => {
      const pasted = input.pastedTexts.find((entry) => entry.id === pastedTextId);
      if (!pasted) return;
      input.discardPromptHistory();
      const current = input.promptRef.current;
      const separator = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
      const nextPrompt = `${current}${separator}${pasted.text}`;
      input.promptRef.current = nextPrompt;
      input.setPrompt(nextPrompt);
      useComposerDraftStore.getState().removePastedText(input.threadId, pastedTextId);
      input.setComposerCursor(collapseExpandedComposerCursor(nextPrompt, nextPrompt.length));
      input.setComposerTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
      window.requestAnimationFrame(() => input.editorRef.current?.focusAtEnd());
    },
    [input],
  );

  const addTerminalContext = useCallback(
    (selection: TerminalContextSelection) => {
      if (!input.activeThreadId) return;
      input.discardPromptHistory();
      const snapshot = input.editorRef.current?.readSnapshot() ?? {
        value: input.promptRef.current,
        cursor: input.composerCursor,
        expandedCursor: expandCollapsedComposerCursor(
          input.promptRef.current,
          input.composerCursor,
        ),
        selectionCollapsed: true,
        terminalContextIds: input.terminalContexts.map((context) => context.id),
      };
      const insertion = insertInlineTerminalContextPlaceholder(
        snapshot.value,
        snapshot.expandedCursor,
      );
      const collapsedCursor = collapseExpandedComposerCursor(insertion.prompt, insertion.cursor);
      const inserted = useComposerDraftStore.getState().insertTerminalContext(
        input.activeThreadId,
        insertion.prompt,
        {
          id: randomUUID(),
          threadId: input.activeThreadId,
          createdAt: new Date().toISOString(),
          ...selection,
        },
        insertion.contextIndex,
      );
      if (!inserted) return;
      input.promptRef.current = insertion.prompt;
      input.setComposerCursor(collapsedCursor);
      input.setComposerTrigger(detectComposerTrigger(insertion.prompt, insertion.cursor));
      window.requestAnimationFrame(() => input.editorRef.current?.focusAt(collapsedCursor));
    },
    [input],
  );

  const addPastedText = useCallback(
    (text: string) => {
      if (!input.activeThreadId) return;
      mutate((store) =>
        store.addPastedTexts(input.activeThreadId!, [
          createPastedTextDraft({
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            text,
          }),
        ]),
      );
    },
    [input.activeThreadId, mutate],
  );

  const addImages = useCallback(
    (files: readonly File[]) => {
      if (!input.activeThreadId || files.length === 0) return;
      if (input.pendingUserInputCount > 0) {
        toastManager.add({
          type: "error",
          title: "Attach images after answering plan questions.",
        });
        return;
      }
      const result = buildComposerImageAttachmentsFromFiles({
        files,
        existingAttachmentCount: effectiveComposerAttachmentCount(
          useComposerDraftStore.getState().draftsByThreadId[input.activeThreadId],
        ),
      });
      if (result.images.length === 1 && result.images[0]) {
        mutate((store) => store.addImage(input.threadId, result.images[0]!));
      } else if (result.images.length > 1) {
        addImagesToDraft(result.images);
      }
      input.setThreadError(input.activeThreadId, result.error);
    },
    [input, addImagesToDraft, mutate],
  );

  const addFiles = useCallback(
    (files: readonly File[]) => {
      if (!input.activeThreadId || files.length === 0) return;
      if (input.pendingUserInputCount > 0) {
        toastManager.add({ type: "error", title: "Attach files after answering plan questions." });
        return;
      }
      const result = buildComposerFileAttachmentsFromFiles({
        files,
        existingAttachmentCount: effectiveComposerAttachmentCount(
          useComposerDraftStore.getState().draftsByThreadId[input.activeThreadId],
        ),
      });
      if (result.files.length > 0) addFilesToDraft(result.files);
      input.setThreadError(input.activeThreadId, result.error);
    },
    [input, addFilesToDraft],
  );

  const dropzone = useComposerDropzone({
    addImages,
    fileSupport: { genericFiles: "accept", addFiles },
    appendReferenceText: (text) => appendComposerPromptText(input.threadId, text),
    appendPathMentions: (paths) => {
      for (const path of paths) {
        appendComposerPromptText(input.threadId, formatComposerMentionToken(path));
      }
    },
    dragDepthRef: input.dragDepthRef,
    focusComposer: input.focusComposer,
    setIsDragOverComposer: input.setIsDragOverComposer,
  });

  return {
    actions: {
      addAssistantSelectionToDraft,
      addFileCommentToDraft,
      addFiles,
      addFilesToDraft,
      addImages,
      addImagesToDraft,
      addPastedText,
      addPastedTextsToDraft,
      addTerminalContext,
      addTerminalContextsToDraft,
      clearAssistantSelections,
      clearFileComments,
      removeFile,
      removeImage,
      removePastedText,
      removeTerminalContext,
      showPastedTextInField,
    },
    dropzone,
    nonPersistedImageIdSet,
    refs: {
      assistantSelections: assistantSelectionsRef,
      fileComments: fileCommentsRef,
      files: filesRef,
      images: imagesRef,
      pastedTexts: pastedTextsRef,
      terminalContexts: terminalContextsRef,
    },
  };
}
