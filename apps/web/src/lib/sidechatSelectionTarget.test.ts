import { ThreadId } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import type { RightDockPane, RightDockThreadState } from "../rightDockStore.logic";
import { resolveVisibleSidechatTargetThreadId } from "./sidechatSelectionTarget";

function pane(id: string, kind: RightDockPane["kind"], threadId: string | null): RightDockPane {
  return {
    id,
    kind,
    threadId: threadId ? ThreadId.makeUnsafe(threadId) : null,
    diffTurnId: null,
    diffFilePath: null,
    filePath: null,
    pullRequestProjectId: null,
    pullRequestRepository: null,
    pullRequestNumber: null,
    pullRequestInitialTab: null,
  };
}

describe("resolveVisibleSidechatTargetThreadId", () => {
  const firstSide = pane("side-1", "sidechat", "thread-side-1");
  const secondSide = pane("side-2", "sidechat", "thread-side-2");

  it("targets the active Side when several Side tabs exist", () => {
    const state: RightDockThreadState = {
      open: true,
      panes: [firstSide, secondSide],
      activePaneId: secondSide.id,
    };

    expect(resolveVisibleSidechatTargetThreadId(state)).toBe("thread-side-2");
  });

  it("does not target a hidden or inactive Side", () => {
    const hidden: RightDockThreadState = {
      open: false,
      panes: [firstSide],
      activePaneId: firstSide.id,
    };
    const fileActive: RightDockThreadState = {
      open: true,
      panes: [firstSide, pane("file", "file", null)],
      activePaneId: "file",
    };

    expect(resolveVisibleSidechatTargetThreadId(hidden)).toBeNull();
    expect(resolveVisibleSidechatTargetThreadId(fileActive)).toBeNull();
  });
});
