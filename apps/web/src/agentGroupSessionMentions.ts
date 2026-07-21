import {
  normalizeProviderDiscoveryText,
  rankProviderDiscoveryItems,
} from "~/lib/providerDiscovery";
import { isAgentGroupSession } from "./agentGroupCapabilities";

interface SessionMentionThread {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly parentThreadId?: string | null;
  readonly archivedAt?: string | null;
  readonly subagentAgentId?: string | null;
  readonly subagentNickname?: string | null;
  readonly subagentRole?: string | null;
  readonly sidechatSourceThreadId?: string | null;
  readonly forkSourceThreadId?: string | null;
  readonly handoff?: unknown | null;
}

export interface AgentGroupSessionMentionCandidate {
  readonly sessionId: string;
  readonly title: string;
  readonly mentionName: string;
  readonly description: string;
  readonly parentTitle?: string;
}

export function buildAgentGroupSessionMentionCandidates(input: {
  readonly threads: ReadonlyArray<SessionMentionThread>;
  readonly activeThreadId: string | null;
  readonly activeProjectId: string | null;
}): AgentGroupSessionMentionCandidate[] {
  if (!input.activeThreadId || !input.activeProjectId) return [];

  const eligible = input.threads.filter(
    (thread) =>
      thread.projectId === input.activeProjectId &&
      thread.id !== input.activeThreadId &&
      isAgentGroupSession(thread),
  );
  const titleCounts = new Map<string, number>();
  for (const thread of eligible) {
    const titleKey = normalizeProviderDiscoveryText(thread.title);
    titleCounts.set(titleKey, (titleCounts.get(titleKey) ?? 0) + 1);
  }
  const byId = new Map(input.threads.map((thread) => [thread.id, thread]));

  return eligible.map((thread) => {
    const shortId = thread.id.slice(-6);
    const parentTitle = thread.parentThreadId ? byId.get(thread.parentThreadId)?.title : undefined;
    const duplicateTitle = (titleCounts.get(normalizeProviderDiscoveryText(thread.title)) ?? 0) > 1;
    return {
      sessionId: thread.id,
      title: thread.title,
      mentionName: duplicateTitle ? `${thread.title} · ${shortId}` : thread.title,
      description: parentTitle ? `Child of ${parentTitle} · ${shortId}` : `Session · ${shortId}`,
      ...(parentTitle ? { parentTitle } : {}),
    };
  });
}

export function rankAgentGroupSessionMentionCandidates(
  candidates: ReadonlyArray<AgentGroupSessionMentionCandidate>,
  query: string,
): AgentGroupSessionMentionCandidate[] {
  return rankProviderDiscoveryItems(
    candidates,
    normalizeProviderDiscoveryText(query),
    (candidate) => [
      { value: candidate.title },
      { value: candidate.mentionName },
      { value: candidate.sessionId },
      ...(candidate.parentTitle ? [{ value: candidate.parentTitle, weight: 200 }] : []),
    ],
  );
}
