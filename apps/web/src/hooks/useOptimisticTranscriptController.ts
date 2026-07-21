// FILE: useOptimisticTranscriptController.ts
// Purpose: Own optimistic user rows and their attachment-preview handoff.
// Layer: Web transcript controller

import { MessageId, type ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { derivePromptHistoryFromMessages } from "../components/ChatView.composerHistory";
import { filterSidechatTranscriptMessages } from "../components/ChatView.threadPresentation";
import {
  collectUserMessageBlobPreviewUrls,
  revokeBlobPreviewUrl,
  revokeUserMessagePreviewUrls,
} from "../components/ChatView.voiceAttachments";
import {
  ATTACHMENT_PREVIEW_HANDOFF_TTL_MS,
  revokeBlobPreviewUrlsAfterPaint,
} from "../components/chat/chatViewAttachmentHandoff";
import type { PendingAutomationConversation } from "./useAutomationConversationController";
import type { ChatMessage } from "../types";

interface OptimisticTranscriptInput {
  readonly threadId: ThreadId;
  readonly activeThreadId: ThreadId | null;
  readonly serverMessages: readonly ChatMessage[] | undefined;
  readonly promptHistoryMessages: readonly ChatMessage[] | undefined;
  readonly hasSidechatSource: boolean;
  readonly automationConversation: PendingAutomationConversation | null;
}

function applyAttachmentPreviewHandoffs(
  messages: readonly ChatMessage[],
  handoffByMessageId: Readonly<Record<string, readonly string[]>>,
): ChatMessage[] {
  if (Object.keys(handoffByMessageId).length === 0) {
    return messages as ChatMessage[];
  }

  return messages.map((message) => {
    if (message.role !== "user" || !message.attachments || message.attachments.length === 0) {
      return message;
    }
    const handoffPreviewUrls = handoffByMessageId[message.id];
    if (!handoffPreviewUrls || handoffPreviewUrls.length === 0) {
      return message;
    }

    let changed = false;
    let imageIndex = 0;
    const attachments = message.attachments.map((attachment) => {
      if (attachment.type !== "image") {
        return attachment;
      }
      const handoffPreviewUrl = handoffPreviewUrls[imageIndex];
      imageIndex += 1;
      if (!handoffPreviewUrl || attachment.previewUrl === handoffPreviewUrl) {
        return attachment;
      }
      changed = true;
      return { ...attachment, previewUrl: handoffPreviewUrl };
    });

    return changed ? { ...message, attachments } : message;
  });
}

export function useOptimisticTranscriptController(input: OptimisticTranscriptInput) {
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([]);
  const optimisticUserMessagesRef = useRef(optimisticUserMessages);
  optimisticUserMessagesRef.current = optimisticUserMessages;

  const [attachmentPreviewHandoffByMessageId, setAttachmentPreviewHandoffByMessageId] = useState<
    Record<string, string[]>
  >({});
  const attachmentPreviewHandoffByMessageIdRef = useRef<Record<string, string[]>>({});
  const attachmentPreviewHandoffTimeoutByMessageIdRef = useRef<Record<string, number>>({});
  attachmentPreviewHandoffByMessageIdRef.current = attachmentPreviewHandoffByMessageId;

  const updateOptimisticMessages = useCallback(
    (update: (existing: ChatMessage[]) => ChatMessage[]) => {
      setOptimisticUserMessages((existing) => {
        const next = update(existing);
        optimisticUserMessagesRef.current = next;
        return next;
      });
    },
    [],
  );

  const appendOptimisticUserMessage = useCallback(
    (message: ChatMessage) => {
      updateOptimisticMessages((existing) => [...existing, message]);
    },
    [updateOptimisticMessages],
  );

  const removeOptimisticUserMessage = useCallback(
    (messageId: MessageId) => {
      updateOptimisticMessages((existing) => {
        const removed = existing.filter((message) => message.id === messageId);
        for (const message of removed) {
          revokeUserMessagePreviewUrls(message);
        }
        const next = existing.filter((message) => message.id !== messageId);
        return next.length === existing.length ? existing : next;
      });
    },
    [updateOptimisticMessages],
  );

  const clearOptimisticUserMessages = useCallback(() => {
    updateOptimisticMessages((existing) => {
      if (existing.length === 0) return existing;
      for (const message of existing) {
        revokeUserMessagePreviewUrls(message);
      }
      return [];
    });
  }, [updateOptimisticMessages]);

  const clearAttachmentPreviewHandoffs = useCallback(() => {
    for (const timeoutId of Object.values(attachmentPreviewHandoffTimeoutByMessageIdRef.current)) {
      window.clearTimeout(timeoutId);
    }
    attachmentPreviewHandoffTimeoutByMessageIdRef.current = {};
    for (const previewUrls of Object.values(attachmentPreviewHandoffByMessageIdRef.current)) {
      for (const previewUrl of previewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    attachmentPreviewHandoffByMessageIdRef.current = {};
    setAttachmentPreviewHandoffByMessageId({});
  }, []);

  const handoffAttachmentPreviews = useCallback((messageId: MessageId, previewUrls: string[]) => {
    if (previewUrls.length === 0) return;

    const previousPreviewUrls = attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
    const replacedPreviewUrls = previousPreviewUrls.filter(
      (previewUrl) => !previewUrls.includes(previewUrl),
    );
    revokeBlobPreviewUrlsAfterPaint(replacedPreviewUrls);
    setAttachmentPreviewHandoffByMessageId((existing) => {
      const next = { ...existing, [messageId]: previewUrls };
      attachmentPreviewHandoffByMessageIdRef.current = next;
      return next;
    });

    const existingTimeout = attachmentPreviewHandoffTimeoutByMessageIdRef.current[messageId];
    if (typeof existingTimeout === "number") {
      window.clearTimeout(existingTimeout);
    }
    attachmentPreviewHandoffTimeoutByMessageIdRef.current[messageId] = window.setTimeout(() => {
      const currentPreviewUrls = attachmentPreviewHandoffByMessageIdRef.current[messageId];
      setAttachmentPreviewHandoffByMessageId((existing) => {
        if (!(messageId in existing)) return existing;
        const next = { ...existing };
        delete next[messageId];
        attachmentPreviewHandoffByMessageIdRef.current = next;
        return next;
      });
      delete attachmentPreviewHandoffTimeoutByMessageIdRef.current[messageId];
      if (currentPreviewUrls) {
        revokeBlobPreviewUrlsAfterPaint(currentPreviewUrls);
      }
    }, ATTACHMENT_PREVIEW_HANDOFF_TTL_MS);
  }, []);

  useEffect(
    () => () => {
      clearAttachmentPreviewHandoffs();
      for (const message of optimisticUserMessagesRef.current) {
        revokeUserMessagePreviewUrls(message);
      }
    },
    [clearAttachmentPreviewHandoffs],
  );

  useLayoutEffect(() => {
    clearOptimisticUserMessages();
  }, [clearOptimisticUserMessages, input.threadId]);

  useEffect(() => {
    if (!input.activeThreadId || !input.serverMessages || input.serverMessages.length === 0) {
      return;
    }
    if (optimisticUserMessages.length === 0) {
      return;
    }
    const serverIds = new Set(input.serverMessages.map((message) => message.id));
    const removedMessages = optimisticUserMessages.filter((message) => serverIds.has(message.id));
    if (removedMessages.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      updateOptimisticMessages((existing) =>
        existing.filter((message) => !serverIds.has(message.id)),
      );
    }, 0);
    for (const removedMessage of removedMessages) {
      const previewUrls = collectUserMessageBlobPreviewUrls(removedMessage);
      if (previewUrls.length > 0) {
        handoffAttachmentPreviews(removedMessage.id, previewUrls);
      } else {
        revokeUserMessagePreviewUrls(removedMessage);
      }
    }
    return () => window.clearTimeout(timer);
  }, [
    handoffAttachmentPreviews,
    input.activeThreadId,
    input.serverMessages,
    optimisticUserMessages,
    updateOptimisticMessages,
  ]);

  const promptHistory = useMemo(() => {
    const activeMessages = input.promptHistoryMessages ?? [];
    if (optimisticUserMessages.length === 0) {
      return derivePromptHistoryFromMessages(activeMessages);
    }
    const activeMessageIds = new Set(activeMessages.map((message) => message.id));
    const pending = optimisticUserMessages.filter((message) => !activeMessageIds.has(message.id));
    return derivePromptHistoryFromMessages([...activeMessages, ...pending]);
  }, [input.promptHistoryMessages, optimisticUserMessages]);

  const timelineMessages = useMemo(() => {
    const filtered = filterSidechatTranscriptMessages(
      input.serverMessages ?? [],
      input.hasSidechatSource,
    );
    const serverWithPreviewHandoff = applyAttachmentPreviewHandoffs(
      filtered,
      attachmentPreviewHandoffByMessageId,
    );
    let pendingMessages = optimisticUserMessages;
    if (pendingMessages.length > 0) {
      const serverIds = new Set(serverWithPreviewHandoff.map((message) => message.id));
      pendingMessages = pendingMessages.filter((message) => !serverIds.has(message.id));
    }
    const withPending =
      pendingMessages.length === 0
        ? serverWithPreviewHandoff
        : [...serverWithPreviewHandoff, ...pendingMessages];
    const setupBubbles =
      input.automationConversation?.threadId === input.threadId
        ? input.automationConversation.bubbles
        : [];
    return setupBubbles.length === 0 ? withPending : [...withPending, ...setupBubbles];
  }, [
    attachmentPreviewHandoffByMessageId,
    input.automationConversation,
    input.hasSidechatSource,
    input.serverMessages,
    input.threadId,
    optimisticUserMessages,
  ]);

  const enteringUserMessageIds = useMemo<ReadonlySet<MessageId>>(
    () => new Set(optimisticUserMessages.map((message) => message.id)),
    [optimisticUserMessages],
  );

  return {
    appendOptimisticUserMessage,
    enteringUserMessageIds,
    promptHistory,
    removeOptimisticUserMessage,
    timelineMessages,
  };
}
