import type { ProjectId, ProviderKind, ThreadId } from "@agent-group/contracts";
import { buildPromptThreadTitleFallback } from "@agent-group/shared/chatThreads";
import { deriveActiveWorkStartedAt } from "../../../session-logic";
import type { SidebarThreadSummary } from "../../../types";
import { compareKanbanCardsByRecencyDesc, orderDraftCards } from "./kanbanOrdering";
import { deriveKanbanColumn } from "./kanbanStatusReadModel";
import {
  KANBAN_FALLBACK_DRAFT_TITLE,
  kanbanDraftCardId,
  kanbanThreadCardId,
  type BuildKanbanBoardInput,
  type KanbanBoard,
  type KanbanCard,
  type KanbanColumnKey,
  type KanbanDraftThreadSnapshot,
  type KanbanOptimisticDispatchSnapshot,
  type KanbanProjectBoard,
} from "./kanbanTypes";

function toSortableTimestamp(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function resolveThreadCardTimestamp(
  thread: SidebarThreadSummary,
  column: KanbanColumnKey,
): string | null {
  if (column === "done" && thread.latestTurn?.completedAt) {
    return thread.latestTurn.completedAt;
  }
  if (column === "inProgress") {
    const liveTimestamp = thread.latestTurn?.startedAt ?? thread.latestTurn?.requestedAt ?? null;
    if (liveTimestamp) {
      return liveTimestamp;
    }
  }
  return thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt ?? null;
}

function resolveComposerDraft(
  composerDraftByThreadId: BuildKanbanBoardInput["composerDraftByThreadId"],
  threadId: ThreadId,
): { prompt: string; hasAttachments: boolean; provider: ProviderKind | null } {
  const snapshot = composerDraftByThreadId[threadId];
  return {
    prompt: snapshot?.prompt.trim() ?? "",
    hasAttachments: snapshot?.hasAttachments ?? false,
    provider: snapshot?.provider ?? null,
  };
}

function buildThreadCard(
  thread: SidebarThreadSummary,
  composerDraftByThreadId: BuildKanbanBoardInput["composerDraftByThreadId"],
  isTerminal: boolean,
): KanbanCard {
  const column = deriveKanbanColumn(thread);
  const composerDraft = resolveComposerDraft(composerDraftByThreadId, thread.id);
  const timestamp = resolveThreadCardTimestamp(thread, column);
  const threadProvider = isTerminal
    ? null
    : (thread.session?.provider ?? thread.modelSelection.provider);
  const activeWorkStartedAt =
    column === "inProgress"
      ? deriveActiveWorkStartedAt(thread.latestTurn, thread.session, timestamp)
      : null;
  return {
    cardId: kanbanThreadCardId(thread.id),
    threadId: thread.id,
    projectId: thread.projectId,
    column,
    title: thread.title,
    provider:
      column === "draft" && composerDraft.provider ? composerDraft.provider : threadProvider,
    isTerminal,
    branch: thread.branch,
    envMode: thread.envMode ?? null,
    worktreePath: thread.worktreePath,
    thread,
    draftPrompt: column === "draft" ? composerDraft.prompt : "",
    draftHasAttachments: column === "draft" ? composerDraft.hasAttachments : false,
    sortTimestamp: toSortableTimestamp(timestamp) ?? Number.NEGATIVE_INFINITY,
    timestamp,
    activeWorkStartedAt,
    isOptimisticDispatch: false,
  };
}

function buildUnsentPromptCard(
  thread: SidebarThreadSummary,
  composerDraftByThreadId: BuildKanbanBoardInput["composerDraftByThreadId"],
  isTerminal: boolean,
): KanbanCard | null {
  const composerDraft = resolveComposerDraft(composerDraftByThreadId, thread.id);
  if (composerDraft.prompt.length === 0 && !composerDraft.hasAttachments) {
    return null;
  }
  const titleSeed = composerDraft.prompt.length > 0 ? composerDraft.prompt : "Attached references";
  const threadProvider = isTerminal
    ? null
    : (thread.session?.provider ?? thread.modelSelection.provider);
  return {
    cardId: kanbanDraftCardId(thread.id),
    threadId: thread.id,
    projectId: thread.projectId,
    column: "draft",
    title: buildPromptThreadTitleFallback(titleSeed),
    provider: composerDraft.provider ?? threadProvider,
    isTerminal,
    branch: thread.branch,
    envMode: thread.envMode ?? null,
    worktreePath: thread.worktreePath,
    thread,
    draftPrompt: composerDraft.prompt,
    draftHasAttachments: composerDraft.hasAttachments,
    sortTimestamp:
      toSortableTimestamp(thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt) ??
      Number.NEGATIVE_INFINITY,
    timestamp: thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt ?? null,
    activeWorkStartedAt: null,
    isOptimisticDispatch: false,
  };
}

function buildLocalDraftCard(
  draftThread: KanbanDraftThreadSnapshot,
  composerDraftByThreadId: BuildKanbanBoardInput["composerDraftByThreadId"],
): KanbanCard {
  const composerDraft = resolveComposerDraft(composerDraftByThreadId, draftThread.threadId);
  return {
    cardId: kanbanDraftCardId(draftThread.threadId),
    threadId: draftThread.threadId,
    projectId: draftThread.projectId,
    column: "draft",
    title:
      composerDraft.prompt.length > 0
        ? buildPromptThreadTitleFallback(composerDraft.prompt)
        : composerDraft.hasAttachments
          ? "Attached references"
          : KANBAN_FALLBACK_DRAFT_TITLE,
    provider: composerDraft.provider,
    isTerminal: false,
    branch: draftThread.branch,
    envMode: draftThread.envMode ?? null,
    worktreePath: draftThread.worktreePath ?? null,
    thread: null,
    draftPrompt: composerDraft.prompt,
    draftHasAttachments: composerDraft.hasAttachments,
    sortTimestamp: toSortableTimestamp(draftThread.createdAt) ?? Number.NEGATIVE_INFINITY,
    timestamp: draftThread.createdAt,
    activeWorkStartedAt: null,
    isOptimisticDispatch: false,
  };
}

function forceOptimisticInProgressCard(
  card: KanbanCard,
  entry: KanbanOptimisticDispatchSnapshot,
): KanbanCard {
  return {
    ...card,
    column: "inProgress",
    isOptimisticDispatch: true,
    title:
      card.title === KANBAN_FALLBACK_DRAFT_TITLE && entry.title.length > 0
        ? entry.title
        : card.title,
    draftPrompt: "",
    draftHasAttachments: false,
    sortTimestamp: entry.droppedAtMs,
    timestamp: null,
    activeWorkStartedAt: new Date(entry.droppedAtMs).toISOString(),
  };
}

function buildSyntheticOptimisticCard(
  threadId: ThreadId,
  entry: KanbanOptimisticDispatchSnapshot,
): KanbanCard {
  return {
    cardId: kanbanThreadCardId(threadId),
    threadId,
    projectId: entry.projectId,
    column: "inProgress",
    title: entry.title,
    provider: entry.provider,
    isTerminal: false,
    branch: null,
    envMode: null,
    worktreePath: null,
    thread: null,
    draftPrompt: "",
    draftHasAttachments: false,
    sortTimestamp: entry.droppedAtMs,
    timestamp: null,
    activeWorkStartedAt: new Date(entry.droppedAtMs).toISOString(),
    isOptimisticDispatch: true,
  };
}

export function buildKanbanBoard(input: BuildKanbanBoardInput): KanbanBoard {
  const threadIds = new Set<string>();
  const cardsByProjectId = new Map<
    ProjectId,
    { draft: KanbanCard[]; inProgress: KanbanCard[]; done: KanbanCard[] }
  >();
  const knownProjectIds = new Set<string>(input.projects.map((project) => project.id));
  const optimisticDispatchByThreadId = input.optimisticDispatchByThreadId ?? {};
  const handledOptimisticThreadIds = new Set<string>();

  const resolveBoardProjectId = (projectId: ProjectId): ProjectId =>
    input.projectIdAliases?.[projectId] ?? projectId;

  const bucketFor = (projectId: ProjectId) => {
    let bucket = cardsByProjectId.get(projectId);
    if (!bucket) {
      bucket = { draft: [], inProgress: [], done: [] };
      cardsByProjectId.set(projectId, bucket);
    }
    return bucket;
  };

  for (const thread of input.threads) {
    const boardProjectId = resolveBoardProjectId(thread.projectId);
    if (!knownProjectIds.has(boardProjectId)) continue;
    threadIds.add(thread.id);
    const bucket = bucketFor(boardProjectId);
    const isTerminal = input.terminalEntryThreadIds?.has(thread.id) ?? false;
    const card = buildThreadCard(thread, input.composerDraftByThreadId, isTerminal);
    const optimisticEntry = optimisticDispatchByThreadId[thread.id];
    if (optimisticEntry) {
      handledOptimisticThreadIds.add(thread.id);
      if (card.column !== "inProgress") {
        bucket.inProgress.push(forceOptimisticInProgressCard(card, optimisticEntry));
        continue;
      }
    }
    bucket[card.column].push(card);
    if (card.column === "done") {
      const unsentPromptCard = buildUnsentPromptCard(
        thread,
        input.composerDraftByThreadId,
        isTerminal,
      );
      if (unsentPromptCard) bucket.draft.push(unsentPromptCard);
    }
  }

  for (const draftThread of input.draftThreads) {
    const boardProjectId = resolveBoardProjectId(draftThread.projectId);
    if (threadIds.has(draftThread.threadId) || !knownProjectIds.has(boardProjectId)) continue;
    const optimisticEntry = optimisticDispatchByThreadId[draftThread.threadId];
    const composerDraft = resolveComposerDraft(input.composerDraftByThreadId, draftThread.threadId);
    if (!optimisticEntry && composerDraft.prompt.length === 0 && !composerDraft.hasAttachments) {
      continue;
    }
    const card = buildLocalDraftCard(draftThread, input.composerDraftByThreadId);
    if (optimisticEntry) {
      handledOptimisticThreadIds.add(draftThread.threadId);
      bucketFor(boardProjectId).inProgress.push(
        forceOptimisticInProgressCard(card, optimisticEntry),
      );
      continue;
    }
    bucketFor(boardProjectId).draft.push(card);
  }

  for (const [threadId, optimisticEntry] of Object.entries(optimisticDispatchByThreadId)) {
    if (!optimisticEntry || handledOptimisticThreadIds.has(threadId)) continue;
    const boardProjectId = resolveBoardProjectId(optimisticEntry.projectId);
    if (!knownProjectIds.has(boardProjectId)) continue;
    bucketFor(boardProjectId).inProgress.push(
      buildSyntheticOptimisticCard(threadId as ThreadId, optimisticEntry),
    );
  }

  let totalCount = 0;
  const projects = input.projects.map((project): KanbanProjectBoard => {
    const bucket = cardsByProjectId.get(project.id) ?? { draft: [], inProgress: [], done: [] };
    const draft = orderDraftCards(bucket.draft, input.draftOrderByProjectId[project.id]);
    const inProgress = bucket.inProgress.toSorted(compareKanbanCardsByRecencyDesc);
    const done = bucket.done.toSorted(compareKanbanCardsByRecencyDesc);
    const projectTotalCount = draft.length + inProgress.length + done.length;
    totalCount += projectTotalCount;
    return {
      projectId: project.id,
      projectName: project.name,
      projectKind: project.kind,
      draft,
      inProgress,
      done,
      totalCount: projectTotalCount,
    };
  });

  return { projects, totalCount };
}
