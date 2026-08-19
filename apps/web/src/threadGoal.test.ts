import { describe, expect, it, vi } from "vitest";

const dispatchCommand = vi.fn<(command: unknown) => Promise<void>>();

vi.mock("./nativeApi", () => ({
  readNativeApi: () => ({ orchestration: { dispatchCommand } }),
}));

import {
  dispatchThreadGoal,
  dispatchThreadGoalAchieved,
  dispatchThreadGoalPaused,
} from "./threadGoal";

describe("thread goal commands", () => {
  it("dispatches set, pause, completion, and clear as distinct metadata intents", async () => {
    dispatchCommand.mockReset().mockResolvedValue(undefined);
    const threadId = "thread-goal" as never;

    await dispatchThreadGoal(threadId, "  Ship the feature  ");
    await dispatchThreadGoalPaused(threadId, true);
    await dispatchThreadGoalAchieved(threadId);
    await dispatchThreadGoal(threadId, "");

    expect(dispatchCommand.mock.calls.map(([value]) => value)).toMatchObject([
      { type: "thread.meta.update", threadId: "thread-goal", goal: "Ship the feature" },
      { type: "thread.meta.update", threadId: "thread-goal", goalPaused: true },
      { type: "thread.meta.update", threadId: "thread-goal", goalAchieved: true },
      { type: "thread.meta.update", threadId: "thread-goal", goal: "" },
    ]);
  });
});
