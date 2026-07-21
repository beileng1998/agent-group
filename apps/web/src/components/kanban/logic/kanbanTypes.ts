import type {
  ProjectId,
  ProviderKind,
  ThreadEnvironmentMode,
  ThreadId,
} from "@agent-group/contracts";
import type { Project, SidebarThreadSummary } from "../../../types";

export type KanbanColumnKey = "draft" | "inProgress" | "done";

export const KANBAN_COLUMN_LABELS: Record<KanbanColumnKey, string> = {
  draft: "Draft",
  inProgress: "In Progress",
  done: "Done",
};

export const KANBAN_FALLBACK_DRAFT_TITLE = "New thread";

/** Pending composer content for one thread, projected from the composer draft store. */
export interface KanbanComposerDraftSnapshot {
  prompt: string;
  /** Files, images, terminal contexts, or references attached to the composer draft. */
  hasAttachments: boolean;
  provider: ProviderKind | null;
}

/**
 * A draft dropped on In Progress whose first runtime signal has not arrived yet.
 * Provider session init can take seconds, so the board keeps the card optimistic
 * until runtime state settles or the entry expires.
 */
export interface KanbanOptimisticDispatchSnapshot {
  projectId: ProjectId;
  title: string;
  provider: ProviderKind | null;
  baselineTurnId: string | null;
  droppedAtMs: number;
}

/** Local-only (unpromoted) draft thread, projected from the composer draft store. */
export interface KanbanDraftThreadSnapshot {
  threadId: ThreadId;
  projectId: ProjectId;
  createdAt: string;
  branch: string | null;
  envMode?: ThreadEnvironmentMode | null;
  worktreePath?: string | null;
}

export interface KanbanCard {
  /** Unique drag/render identity; a thread may also have an unsent draft card. */
  cardId: string;
  threadId: ThreadId;
  projectId: ProjectId;
  column: KanbanColumnKey;
  title: string;
  provider: ProviderKind | null;
  isTerminal: boolean;
  branch: string | null;
  envMode: ThreadEnvironmentMode | null;
  worktreePath: string | null;
  thread: SidebarThreadSummary | null;
  draftPrompt: string;
  draftHasAttachments: boolean;
  sortTimestamp: number;
  timestamp: string | null;
  activeWorkStartedAt: string | null;
  isOptimisticDispatch: boolean;
}

export interface KanbanProjectBoard {
  projectId: ProjectId;
  projectName: string;
  projectKind: Project["kind"];
  draft: KanbanCard[];
  inProgress: KanbanCard[];
  done: KanbanCard[];
  totalCount: number;
}

export interface KanbanBoard {
  projects: KanbanProjectBoard[];
  totalCount: number;
}

export interface BuildKanbanBoardInput {
  projects: readonly Pick<Project, "id" | "kind" | "name">[];
  threads: readonly SidebarThreadSummary[];
  draftThreads: readonly KanbanDraftThreadSnapshot[];
  composerDraftByThreadId: Readonly<Record<string, KanbanComposerDraftSnapshot | undefined>>;
  draftOrderByProjectId: Readonly<Record<string, readonly string[] | undefined>>;
  projectIdAliases?: Readonly<Record<string, ProjectId | undefined>>;
  terminalEntryThreadIds?: ReadonlySet<string>;
  optimisticDispatchByThreadId?: Readonly<
    Record<string, KanbanOptimisticDispatchSnapshot | undefined>
  >;
}

export function kanbanThreadCardId(threadId: ThreadId): string {
  return `thread:${threadId}`;
}

export function kanbanDraftCardId(threadId: ThreadId): string {
  return `draft:${threadId}`;
}

/** Draft-only cards clear composer/draft state; thread cards still use thread actions. */
export function isKanbanDraftOnlyCard(
  card: Pick<KanbanCard, "cardId" | "threadId" | "column">,
): boolean {
  return card.column === "draft" && card.cardId === kanbanDraftCardId(card.threadId);
}
