// FILE: useAppSnapTargetActivation.ts
// Purpose: Activates an existing AppSnap target thread and its split pane.
// Layer: Web AppSnap coordinator support

import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import type { AppSnapThreadTarget } from "../../appSnap.logic";
import { resolveRecentThreadSplitActivation } from "../../recentViewActivation.logic";
import { useSplitViewStore } from "../../splitViewStore";

export function useAppSnapTargetActivation(input: {
  focusedTargetRef: { current: AppSnapThreadTarget | null };
  openChatThreadPage: (threadId: AppSnapThreadTarget["threadId"]) => void;
}) {
  const navigate = useNavigate();
  return useCallback(
    async (target: AppSnapThreadTarget) => {
      input.openChatThreadPage(target.threadId);
      const focused = input.focusedTargetRef.current;
      if (
        focused?.threadId === target.threadId &&
        (!target.splitViewId || focused.splitViewId === target.splitViewId)
      ) {
        return;
      }

      const splitActivation = resolveRecentThreadSplitActivation({
        view: {
          kind: "thread",
          threadId: target.threadId,
          ...(target.splitViewId ? { splitViewId: target.splitViewId } : {}),
        },
        splitViewsById: useSplitViewStore.getState().splitViewsById,
      });
      if (splitActivation) {
        useSplitViewStore
          .getState()
          .setFocusedPane(splitActivation.splitViewId, splitActivation.paneId);
      }
      await navigate({
        to: "/$threadId",
        params: { threadId: target.threadId },
        search: () => (splitActivation ? { splitViewId: splitActivation.splitViewId } : {}),
      });
    },
    [input.focusedTargetRef, input.openChatThreadPage, navigate],
  );
}
