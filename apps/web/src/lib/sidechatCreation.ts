// Builds a durable Side turn only when the user supplied a question.

import { MessageId, type UploadChatAttachment } from "@agent-group/contracts";

import { appendAssistantSelectionsToPrompt } from "./assistantSelections";

export interface SidechatTextSelection {
  assistantMessageId: string;
  text: string;
}

export function buildSidechatInitialMessage(input: {
  prompt: string;
  selection?: SidechatTextSelection;
}): { text: string; attachments: UploadChatAttachment[] } | null {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return null;
  }
  const selections = input.selection ? [input.selection] : [];
  const attachments: UploadChatAttachment[] = input.selection
    ? [
        {
          type: "assistant-selection",
          assistantMessageId: MessageId.makeUnsafe(input.selection.assistantMessageId),
          text: input.selection.text,
        },
      ]
    : [];
  return {
    text: appendAssistantSelectionsToPrompt(prompt, selections),
    attachments,
  };
}
