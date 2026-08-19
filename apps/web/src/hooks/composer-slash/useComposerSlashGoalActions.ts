import { useCallback } from "react";

import { toastManager } from "../../components/ui/toast";
import {
  dispatchThreadGoal,
  dispatchThreadGoalAchieved,
  dispatchThreadGoalPaused,
} from "../../threadGoal";
import type { ComposerSlashCommandsInput } from "./types";

export function useComposerSlashGoalActions(input: ComposerSlashCommandsInput) {
  const runGoalSlashCommand = useCallback(
    async (args: string): Promise<void> => {
      const thread = input.activeThread;
      if (!input.isServerThread || !thread || thread.parentThreadId != null) {
        toastManager.add({ type: "warning", title: "Goals require a persisted root thread" });
        return;
      }

      const currentGoal = thread.goal?.trim() ?? "";
      const action = args.trim();
      const normalizedAction = action.toLowerCase();
      try {
        if (!action) {
          input.editorActions.clearComposerSlashDraft();
          toastManager.add({
            type: "info",
            title: currentGoal ? (thread.goalPausedAt ? "Goal paused" : "Goal active") : "No goal",
            description: currentGoal || "Use /goal <objective> to start one.",
          });
          return;
        }
        if (normalizedAction === "edit") {
          input.editorActions.setComposerPromptValue(
            currentGoal ? `/goal ${currentGoal}` : "/goal ",
          );
          input.editorActions.scheduleComposerFocus();
          return;
        }
        if (normalizedAction === "pause" || normalizedAction === "resume") {
          if (!currentGoal) throw new Error("Set a goal before pausing or resuming it.");
          await dispatchThreadGoalPaused(thread.id, normalizedAction === "pause");
        } else if (normalizedAction === "clear") {
          await dispatchThreadGoal(thread.id, "");
        } else if (normalizedAction === "complete") {
          if (!currentGoal) throw new Error("There is no active goal to complete.");
          await dispatchThreadGoalAchieved(thread.id);
        } else {
          await dispatchThreadGoal(thread.id, action);
        }
        input.editorActions.clearComposerSlashDraft();
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not update goal",
          description: error instanceof Error ? error.message : "The goal update failed.",
        });
      }
    },
    [input.activeThread, input.editorActions, input.isServerThread],
  );

  return { runGoalSlashCommand };
}
