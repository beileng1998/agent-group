// FILE: threadScrollPositionStore.ts
// Purpose: Persist the last non-tail transcript position for each thread.
// Layer: UI state store
// Exports: readThreadScrollOffset, rememberThreadScrollPosition

import type { ThreadId } from "@agent-group/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMemoryStorage } from "./lib/storage";

export const MAX_THREAD_SCROLL_POSITIONS = 200;

export interface ThreadScrollPosition {
  threadId: ThreadId;
  offsetPx: number;
  updatedAt: number;
}

interface ThreadScrollPositionStoreState {
  positions: ThreadScrollPosition[];
  remember: (threadId: ThreadId, offsetPx: number | null) => void;
}

const THREAD_SCROLL_POSITION_STORAGE_KEY = "agent-group:thread-scroll-positions:v1";

function normalizeOffsetPx(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value);
}

function normalizeUpdatedAt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function normalizeThreadScrollPositions(input: unknown): ThreadScrollPosition[] {
  if (!Array.isArray(input)) return [];

  const positionsByThreadId = new Map<string, ThreadScrollPosition>();
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const threadId = typeof record.threadId === "string" ? record.threadId.trim() : "";
    const offsetPx = normalizeOffsetPx(record.offsetPx);
    if (!threadId || offsetPx === null) continue;
    const position = {
      threadId: threadId as ThreadId,
      offsetPx,
      updatedAt: normalizeUpdatedAt(record.updatedAt),
    };
    const current = positionsByThreadId.get(threadId);
    if (!current || position.updatedAt > current.updatedAt) {
      positionsByThreadId.set(threadId, position);
    }
  }

  return Array.from(positionsByThreadId.values())
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_THREAD_SCROLL_POSITIONS);
}

export const useThreadScrollPositionStore = create<ThreadScrollPositionStoreState>()(
  persist(
    (set) => ({
      positions: [],
      remember: (threadId, offsetPx) => {
        set((state) => {
          const remaining = state.positions.filter((position) => position.threadId !== threadId);
          const normalizedOffsetPx = normalizeOffsetPx(offsetPx);
          if (normalizedOffsetPx === null) {
            return remaining.length === state.positions.length ? state : { positions: remaining };
          }
          return {
            positions: [
              { threadId, offsetPx: normalizedOffsetPx, updatedAt: Date.now() },
              ...remaining,
            ].slice(0, MAX_THREAD_SCROLL_POSITIONS),
          };
        });
      },
    }),
    {
      name: THREAD_SCROLL_POSITION_STORAGE_KEY,
      storage: createJSONStorage(() =>
        typeof localStorage === "undefined" ? createMemoryStorage() : localStorage,
      ),
      partialize: (state) => ({
        positions: normalizeThreadScrollPositions(state.positions),
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        positions: normalizeThreadScrollPositions(
          (persistedState as Partial<Pick<ThreadScrollPositionStoreState, "positions">> | undefined)
            ?.positions,
        ),
      }),
    },
  ),
);

export function readThreadScrollOffset(threadId: ThreadId): number | null {
  return (
    useThreadScrollPositionStore
      .getState()
      .positions.find((position) => position.threadId === threadId)?.offsetPx ?? null
  );
}

export function rememberThreadScrollPosition(threadId: ThreadId, offsetPx: number | null): void {
  useThreadScrollPositionStore.getState().remember(threadId, offsetPx);
}
