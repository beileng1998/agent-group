import type { ProjectId } from "@agent-group/contracts";

import type { Project, SidebarThreadSummary } from "~/types";

import { agentGroupDisplayTitle } from "./AgentGroupSidebar.logic";
import {
  agentGroupSessionIsRunning,
  agentGroupSessionNeedsAttention,
  agentGroupSessionStatusPriority,
  resolveAgentGroupSessionStatus,
  type AgentGroupSessionStatus,
} from "./AgentGroupSessionStatus";
import {
  matchSidebarSearchThreads,
  type SidebarSearchThread,
  type SidebarSearchThreadMatch,
} from "./SidebarSearchPalette.logic";

export interface AgentGroupSessionPaletteItem {
  readonly group: Project;
  readonly path: string;
  readonly status: AgentGroupSessionStatus | null;
  readonly thread: SidebarThreadSummary;
}

export interface AgentGroupSessionPaletteMatch extends AgentGroupSessionPaletteItem {
  readonly matchKind: SidebarSearchThreadMatch["matchKind"];
  readonly messageMatchCount: number;
  readonly snippet: string | null;
}

export interface AgentGroupSessionPaletteModel {
  readonly attention: readonly AgentGroupSessionPaletteItem[];
  readonly recent: readonly AgentGroupSessionPaletteItem[];
  readonly running: readonly AgentGroupSessionPaletteItem[];
  readonly searchResults: readonly AgentGroupSessionPaletteMatch[];
}

const EMPTY_MESSAGES: readonly { text: string }[] = [];

function parseTime(value: string | null | undefined): number {
  return Date.parse(value ?? "") || 0;
}

function activityTime(item: AgentGroupSessionPaletteItem): number {
  return parseTime(
    item.thread.lastVisitedAt ??
      item.thread.updatedAt ??
      item.thread.session?.updatedAt ??
      item.thread.createdAt,
  );
}

function parentPath(input: {
  group: Project;
  thread: SidebarThreadSummary;
  threadById: ReadonlyMap<string, SidebarThreadSummary>;
}): string {
  const segments = [agentGroupDisplayTitle(input.group)];
  const ancestors: string[] = [];
  const visited = new Set<string>([input.thread.id]);
  let parentId = input.thread.parentThreadId ?? null;

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = input.threadById.get(parentId);
    if (!parent || parent.projectId !== input.group.id) break;
    ancestors.unshift(parent.title || "New session");
    parentId = parent.parentThreadId ?? null;
  }

  return [...segments, ...ancestors].join(" › ");
}

function compareAttention(
  left: AgentGroupSessionPaletteItem,
  right: AgentGroupSessionPaletteItem,
): number {
  const priorityDifference =
    agentGroupSessionStatusPriority(right.status) - agentGroupSessionStatusPriority(left.status);
  return priorityDifference || activityTime(right) - activityTime(left);
}

function compareRecent(
  left: AgentGroupSessionPaletteItem,
  right: AgentGroupSessionPaletteItem,
): number {
  return activityTime(right) - activityTime(left);
}

function toSearchThread(
  item: AgentGroupSessionPaletteItem,
  messagesBySessionId: ReadonlyMap<string, readonly { text: string }[]>,
): SidebarSearchThread {
  return {
    id: item.thread.id,
    title: item.thread.title,
    projectId: item.group.id,
    projectName: agentGroupDisplayTitle(item.group),
    projectRemoteName: item.group.remoteName,
    provider: item.thread.modelSelection.provider,
    createdAt: item.thread.createdAt,
    updatedAt: item.thread.updatedAt,
    messages: messagesBySessionId.get(item.thread.id) ?? EMPTY_MESSAGES,
  };
}

export function buildAgentGroupSessionPaletteModel(input: {
  readonly groups: readonly Project[];
  readonly messagesBySessionId: ReadonlyMap<string, readonly { text: string }[]>;
  readonly query: string;
  readonly sessions: readonly SidebarThreadSummary[];
}): AgentGroupSessionPaletteModel {
  const groupById = new Map<ProjectId, Project>(input.groups.map((group) => [group.id, group]));
  const threadById = new Map(input.sessions.map((thread) => [thread.id, thread]));
  const items = input.sessions.flatMap((thread): AgentGroupSessionPaletteItem[] => {
    const group = groupById.get(thread.projectId);
    if (!group) return [];
    return [
      {
        group,
        path: parentPath({ group, thread, threadById }),
        status: resolveAgentGroupSessionStatus(thread),
        thread,
      },
    ];
  });

  const normalizedQuery = input.query.trim();
  if (normalizedQuery) {
    const itemByThreadId = new Map<string, AgentGroupSessionPaletteItem>(
      items.map((item) => [item.thread.id, item]),
    );
    const searchResults = matchSidebarSearchThreads(
      items.map((item) => toSearchThread(item, input.messagesBySessionId)),
      normalizedQuery,
      20,
    ).flatMap((match): AgentGroupSessionPaletteMatch[] => {
      const item = itemByThreadId.get(match.thread.id);
      return item
        ? [
            {
              ...item,
              matchKind: match.matchKind,
              messageMatchCount: match.messageMatchCount,
              snippet: match.snippet,
            },
          ]
        : [];
    });
    return { attention: [], recent: [], running: [], searchResults };
  }

  const attention = items.filter((item) => agentGroupSessionNeedsAttention(item.status));
  const running = items.filter((item) => agentGroupSessionIsRunning(item.status));
  const categorizedIds = new Set([...attention, ...running].map((item) => item.thread.id));
  const recent = items.filter((item) => !categorizedIds.has(item.thread.id));

  return {
    attention: attention.toSorted(compareAttention).slice(0, 6),
    running: running.toSorted(compareRecent).slice(0, 6),
    recent: recent.toSorted(compareRecent).slice(0, 6),
    searchResults: [],
  };
}
