// FILE: agentGroupPrompt.ts
// Purpose: Build the exact Agent Group user-message envelope shared by runtime and settings UI.
// Layer: Shared runtime utility

import type { AgentGroupPromptInstructions } from "@agent-group/contracts";

export interface AgentGroupPromptInput {
  readonly userText: string;
  readonly attachments?: ReadonlyArray<AgentGroupPromptAttachment>;
  readonly contextPath: string;
  readonly parentContextPath?: string;
  readonly contextAwarenessCommand?: string;
  readonly mentionedSessions?: ReadonlyArray<AgentGroupPromptMentionedSession>;
  readonly browserSessionId?: string;
  readonly firstTurn: boolean;
  readonly globalRules: string;
  readonly groupRules?: string;
  readonly promptInstructions: AgentGroupPromptInstructions;
}

export interface AgentGroupPromptAttachment {
  readonly kind: "image" | "file";
  readonly path: string;
}

export interface AgentGroupPromptMentionedSession {
  readonly sessionId: string;
  readonly title: string;
  readonly contextPath: string;
  readonly transcriptPath?: string;
}

export function agentGroupPromptInstructionsEqual(
  left: AgentGroupPromptInstructions,
  right: AgentGroupPromptInstructions,
): boolean {
  return (
    left.sessionContextFirstTurn === right.sessionContextFirstTurn &&
    left.sessionContextLaterTurn === right.sessionContextLaterTurn &&
    left.parentContext === right.parentContext &&
    left.mentionedSessions === right.mentionedSessions &&
    left.contextChanges === right.contextChanges &&
    left.browserTools === right.browserTools
  );
}

export function buildAgentGroupPrompt(input: AgentGroupPromptInput): string {
  return [
    `<user_request>\n${input.userText}\n</user_request>`,
    attachmentsBlock(input.attachments),
    sessionContextBlock(input),
    input.firstTurn && input.parentContextPath
      ? `<parent_context path="${promptXmlAttribute(input.parentContextPath)}">\n${input.promptInstructions.parentContext}\n</parent_context>`
      : "",
    mentionedSessionsBlock(input.mentionedSessions, input.promptInstructions.mentionedSessions),
    input.contextAwarenessCommand
      ? `<group_context_changes>\n${input.promptInstructions.contextChanges}\n${input.contextAwarenessCommand}\n</group_context_changes>`
      : "",
    input.browserSessionId
      ? `<browser_tools>\n${input.promptInstructions.browserTools}\nplaywright-cli -s=${input.browserSessionId}\n</browser_tools>`
      : "",
    input.globalRules.trim() ? `<rules scope="global">\n${input.globalRules}\n</rules>` : "",
    input.groupRules?.trim() ? `<rules scope="group">\n${input.groupRules}\n</rules>` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function attachmentsBlock(
  attachments: ReadonlyArray<AgentGroupPromptAttachment> | undefined,
): string {
  if (!attachments || attachments.length === 0) return "";
  return [
    "<attachments>",
    ...attachments.map(
      (attachment) => `<attachment kind="${attachment.kind}">${attachment.path}</attachment>`,
    ),
    "</attachments>",
  ].join("\n");
}

function mentionedSessionsBlock(
  sessions: ReadonlyArray<AgentGroupPromptMentionedSession> | undefined,
  instruction: string,
): string {
  if (!sessions || sessions.length === 0) return "";
  return [
    "<mentioned_sessions>",
    instruction,
    ...sessions.map((session) =>
      safePromptJson({
        session_id: session.sessionId,
        title: session.title,
        context_path: session.contextPath,
        ...(session.transcriptPath ? { transcript_path: session.transcriptPath } : {}),
      }),
    ),
    "</mentioned_sessions>",
  ].join("\n");
}

function safePromptJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&]/g, (character) => {
    switch (character) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      default:
        return "\\u0026";
    }
  });
}

function promptXmlAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      case "<":
        return "&lt;";
      default:
        return "&gt;";
    }
  });
}

function sessionContextBlock(input: AgentGroupPromptInput): string {
  const instruction = input.firstTurn
    ? input.promptInstructions.sessionContextFirstTurn
    : input.promptInstructions.sessionContextLaterTurn;
  return `<session_context path="${promptXmlAttribute(input.contextPath)}">\n${instruction}\n</session_context>`;
}
