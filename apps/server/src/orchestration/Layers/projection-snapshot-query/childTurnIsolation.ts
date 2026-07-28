type ThreadParentRow = {
  readonly threadId: string;
  readonly parentThreadId?: string | null;
};

type ThreadTurnRow = {
  readonly threadId: string;
  readonly turnId?: string | null;
};

export type ChildTurnIdsByParent = ReadonlyMap<string, ReadonlySet<string>>;

export function collectChildTurnIdsByParent(
  threads: ReadonlyArray<ThreadParentRow>,
  turns: ReadonlyArray<ThreadTurnRow>,
): ChildTurnIdsByParent {
  const parentByChild = new Map<string, string>();
  for (const thread of threads) {
    if (thread.parentThreadId) {
      parentByChild.set(thread.threadId, thread.parentThreadId);
    }
  }

  const childTurnIdsByParent = new Map<string, Set<string>>();
  for (const turn of turns) {
    const parentThreadId = parentByChild.get(turn.threadId);
    if (!parentThreadId || !turn.turnId) {
      continue;
    }
    const existing = childTurnIdsByParent.get(parentThreadId);
    if (existing) {
      existing.add(turn.turnId);
    } else {
      childTurnIdsByParent.set(parentThreadId, new Set([turn.turnId]));
    }
  }
  return childTurnIdsByParent;
}

export function omitParentCopiesOfChildTurns<T extends ThreadTurnRow>(
  rows: ReadonlyArray<T>,
  childTurnIdsByParent: ChildTurnIdsByParent,
): T[] {
  return rows.filter((row) => {
    if (!row.turnId) {
      return true;
    }
    return !childTurnIdsByParent.get(row.threadId)?.has(row.turnId);
  });
}

export function omitChildTurnRows<T extends Pick<ThreadTurnRow, "turnId">>(
  rows: ReadonlyArray<T>,
  childTurnIds: ReadonlySet<string>,
): T[] {
  return rows.filter((row) => !row.turnId || !childTurnIds.has(row.turnId));
}
