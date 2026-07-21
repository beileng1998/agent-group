// Shared classification for durable Agent Group sessions and temporary sidechats.

import { GENERIC_CHAT_THREAD_TITLE, isGenericChatThreadTitle } from "./chatThreads";

export const TEMPORARY_SIDECHAT_TITLE_PREFIX = "Sidechat:";

export function stripTemporarySidechatTitlePrefix(title: string): string {
  return title.replace(/^Sidechat:\s*/iu, "").trim();
}

export function formatTemporarySidechatTitle(title: string): string {
  const body = stripTemporarySidechatTitlePrefix(title) || GENERIC_CHAT_THREAD_TITLE;
  return `${TEMPORARY_SIDECHAT_TITLE_PREFIX} ${body}`;
}

export const TEMPORARY_SIDECHAT_PLACEHOLDER_TITLE =
  formatTemporarySidechatTitle(GENERIC_CHAT_THREAD_TITLE);

export interface AgentGroupThreadCandidate {
  readonly id: string;
  readonly parentThreadId?: string | null | undefined;
  readonly subagentAgentId?: string | null | undefined;
  readonly subagentNickname?: string | null | undefined;
  readonly subagentRole?: string | null | undefined;
  readonly sidechatSourceThreadId?: string | null | undefined;
  readonly forkSourceThreadId?: string | null | undefined;
  readonly handoff?: unknown | null | undefined;
}

export function isRuntimeSubagentThread(candidate: AgentGroupThreadCandidate): boolean {
  return (
    candidate.id.startsWith("subagent:") ||
    Boolean(candidate.subagentAgentId) ||
    Boolean(candidate.subagentNickname) ||
    Boolean(candidate.subagentRole)
  );
}

export function isPromotedSidechatThread(candidate: AgentGroupThreadCandidate): boolean {
  return (
    Boolean(candidate.sidechatSourceThreadId) &&
    candidate.parentThreadId === candidate.sidechatSourceThreadId &&
    !candidate.forkSourceThreadId
  );
}

export function isTemporarySidechatThread(candidate: AgentGroupThreadCandidate): boolean {
  return Boolean(candidate.sidechatSourceThreadId) && !isPromotedSidechatThread(candidate);
}

export function isAgentGroupSessionThread(candidate: AgentGroupThreadCandidate): boolean {
  return (
    !isRuntimeSubagentThread(candidate) &&
    !candidate.forkSourceThreadId &&
    !candidate.handoff &&
    (!candidate.sidechatSourceThreadId || isPromotedSidechatThread(candidate))
  );
}

export function promotedSidechatTitle(title: string): string {
  const body = stripTemporarySidechatTitlePrefix(title);
  return body && !isGenericChatThreadTitle(body) ? body : "Child session";
}
