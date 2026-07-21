import { ThreadId } from "@agent-group/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_THREAD_SCROLL_POSITIONS,
  normalizeThreadScrollPositions,
  readThreadScrollOffset,
  rememberThreadScrollPosition,
  useThreadScrollPositionStore,
} from "./threadScrollPositionStore";

describe("threadScrollPositionStore", () => {
  beforeEach(() => {
    useThreadScrollPositionStore.setState({ positions: [] });
  });

  it("keeps independent non-tail offsets and clears a thread at the tail", () => {
    const mainThreadId = ThreadId.makeUnsafe("thread-main");
    const sideThreadId = ThreadId.makeUnsafe("thread-side");

    rememberThreadScrollPosition(mainThreadId, 128.6);
    rememberThreadScrollPosition(sideThreadId, 512);

    expect(readThreadScrollOffset(mainThreadId)).toBe(129);
    expect(readThreadScrollOffset(sideThreadId)).toBe(512);

    rememberThreadScrollPosition(mainThreadId, null);

    expect(readThreadScrollOffset(mainThreadId)).toBeNull();
    expect(readThreadScrollOffset(sideThreadId)).toBe(512);
  });

  it("sanitizes persisted data and bounds retained threads", () => {
    const positions = normalizeThreadScrollPositions([
      ...Array.from({ length: MAX_THREAD_SCROLL_POSITIONS + 2 }, (_, index) => ({
        threadId: `thread-${index}`,
        offsetPx: index,
        updatedAt: index,
      })),
      { threadId: "thread-invalid", offsetPx: -1, updatedAt: 999 },
      { threadId: "thread-1", offsetPx: 999, updatedAt: 999 },
    ]);

    expect(positions).toHaveLength(MAX_THREAD_SCROLL_POSITIONS);
    expect(positions[0]).toMatchObject({ threadId: "thread-1", offsetPx: 999 });
    expect(positions).toContainEqual(
      expect.objectContaining({ threadId: "thread-201", offsetPx: 201 }),
    );
    expect(positions.some((position) => position.threadId === "thread-invalid")).toBe(false);
    expect(positions.filter((position) => position.threadId === "thread-1")).toHaveLength(1);
  });
});
