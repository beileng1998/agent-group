import {
  type ChatAttachment,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type ProviderKind,
  type ProviderSkillReference,
} from "@agent-group/contracts";

import type { AgentGroupPromptAttachment } from "../../agentGroup/prompt.ts";
import { resolveAttachmentPath } from "../../attachmentStore.ts";

const SIDECHAT_BOUNDARY_INSTRUCTION =
  "You are in a sidechat. Treat all prior conversation as reference-only context. Do not continue any prior task automatically. Do not mutate files, git, or the workspace and do not run workspace-changing commands unless the latest user message explicitly asks you to do so after this boundary. Use this sidechat for focused explanation, safety checks, summaries, and alternatives.";

type ProviderContextTag = "handoff_context" | "sidechat_context" | "thread_context";

export function toNonEmptyProviderInput(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Codex app-server still expects `$skill` text next to the structured skill item.
export function normalizeSkillMentionTextForProvider(input: {
  readonly provider: ProviderKind;
  readonly messageText: string;
  readonly skills?: ReadonlyArray<ProviderSkillReference>;
}): string {
  if (input.provider !== "codex" || !input.skills || input.skills.length === 0) {
    return input.messageText;
  }

  let nextText = input.messageText;
  for (const skill of input.skills) {
    const escapedName = escapeRegExp(skill.name);
    nextText = nextText.replace(
      new RegExp(`(^|\\s)/${escapedName}(?=\\s|$)`, "gi"),
      `$1$${skill.name}`,
    );
  }
  return nextText;
}

export function attachmentTitleSeed(attachment: ChatAttachment | undefined): string {
  if (!attachment) return "";
  if (attachment.type === "image" || attachment.type === "file") return attachment.name;
  return attachment.text.trim();
}

export function resolveAgentGroupPromptAttachments(
  attachments: ReadonlyArray<ChatAttachment> | undefined,
  attachmentsDir: string,
): AgentGroupPromptAttachment[] {
  const resolved: AgentGroupPromptAttachment[] = [];
  for (const attachment of attachments ?? []) {
    if (attachment.type !== "image" && attachment.type !== "file") continue;
    const attachmentPath = resolveAttachmentPath({ attachmentsDir, attachment });
    if (attachmentPath) resolved.push({ kind: attachment.type, path: attachmentPath });
  }
  return resolved;
}

export function wrapProviderContext(input: {
  readonly tag: ProviderContextTag;
  readonly contextText: string;
  readonly messageText: string;
  readonly wrapLatestUserMessage: boolean;
}): string {
  const messageSection = input.wrapLatestUserMessage
    ? `<latest_user_message>\n${input.messageText}\n</latest_user_message>`
    : input.messageText;
  return `<${input.tag}>\n${input.contextText}\n</${input.tag}>\n\n${messageSection}`;
}

export function availableProviderContextChars(input: {
  readonly tag: ProviderContextTag;
  readonly messageText: string;
  readonly wrapLatestUserMessage: boolean;
}): number {
  return Math.max(
    0,
    PROVIDER_SEND_TURN_MAX_INPUT_CHARS - wrapProviderContext({ ...input, contextText: "" }).length,
  );
}

export function wrapSidechatInput(messageText: string): string {
  return `<sidechat_boundary>\n${SIDECHAT_BOUNDARY_INSTRUCTION}\n</sidechat_boundary>\n\n<latest_user_message>\n${messageText}\n</latest_user_message>`;
}
