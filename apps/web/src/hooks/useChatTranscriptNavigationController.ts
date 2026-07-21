import {
  type MessageId,
  type ProjectId,
  type ProjectScript,
  type ThreadId,
  type TurnId,
} from "@agent-group/contracts";
import { useCallback } from "react";
import type { useNavigate } from "@tanstack/react-router";

import { stripDiffSearchParams } from "../diffRouteSearch";
import type { useHandleNewThread } from "./useHandleNewThread";

type Navigate = ReturnType<typeof useNavigate>;
type HandleNewThread = ReturnType<typeof useHandleNewThread>["handleNewThread"];

export function useChatTranscriptNavigationController(input: {
  route: {
    navigate: Navigate;
    threadId: ThreadId;
    editorRail: boolean;
    diffEnvironmentPending: boolean;
    onOpenTurnDiffPanel?: ((turnId: TurnId, filePath?: string) => void) | undefined;
  };
  diff: {
    activeTurnId: TurnId | null;
  };
  editor: {
    activeProjectId: ProjectId | null;
    newThread: HandleNewThread;
    openThreadPage: (threadId: ThreadId) => void;
  };
  checkpoint: {
    revertTurnCountByUserMessageId: ReadonlyMap<MessageId, number>;
    revertToTurnCount: (turnCount: number) => unknown;
  };
  scripts: {
    run: (script: ProjectScript) => unknown;
  };
}) {
  const { diffEnvironmentPending, editorRail, navigate, onOpenTurnDiffPanel, threadId } =
    input.route;
  const { activeTurnId } = input.diff;
  const { activeProjectId, newThread, openThreadPage } = input.editor;
  const { revertToTurnCount, revertTurnCountByUserMessageId } = input.checkpoint;
  const { run } = input.scripts;
  const openTurnDiff = useCallback(
    (turnId: TurnId, filePath?: string) => {
      if (diffEnvironmentPending) return;
      if (onOpenTurnDiffPanel) {
        onOpenTurnDiffPanel(turnId, filePath);
        return;
      }
      void navigate({
        to: "/$threadId",
        params: { threadId },
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return filePath
            ? { ...rest, panel: "diff", diff: "1", diffTurnId: turnId, diffFilePath: filePath }
            : { ...rest, panel: "diff", diff: "1", diffTurnId: turnId };
        },
      });
    },
    [diffEnvironmentPending, navigate, onOpenTurnDiffPanel, threadId],
  );
  const reviewActiveTurnChanges = useCallback(() => {
    if (activeTurnId) openTurnDiff(activeTurnId);
  }, [activeTurnId, openTurnDiff]);
  const navigateToThread = useCallback(
    (threadId: ThreadId) => {
      void navigate({
        to: "/$threadId",
        params: { threadId },
        search: (previous) =>
          editorRail
            ? { ...stripDiffSearchParams(previous), view: "editor" }
            : stripDiffSearchParams(previous),
      });
    },
    [editorRail, navigate],
  );
  const openAutomation = useCallback(
    (automationId: string) => {
      void navigate({
        to: "/automations/$automationId",
        params: { automationId },
      });
    },
    [navigate],
  );
  const newEditorChat = useCallback(() => {
    if (!activeProjectId) return;
    void newThread(activeProjectId, undefined, {
      search: (previous) => ({ ...stripDiffSearchParams(previous), view: "editor" }),
    });
  }, [activeProjectId, newThread]);
  const openEditorChat = useCallback(
    (threadId: ThreadId) => {
      openThreadPage(threadId);
      navigateToThread(threadId);
    },
    [navigateToThread, openThreadPage],
  );
  const revertUserMessage = useCallback(
    (messageId: MessageId) => {
      const turnCount = revertTurnCountByUserMessageId.get(messageId);
      if (typeof turnCount === "number") void revertToTurnCount(turnCount);
    },
    [revertToTurnCount, revertTurnCountByUserMessageId],
  );
  const runProjectScriptFromHeader = useCallback(
    (script: ProjectScript) => void run(script),
    [run],
  );

  return {
    diff: { openTurn: openTurnDiff, reviewActiveTurnChanges },
    navigation: { toThread: navigateToThread, openAutomation },
    editor: { newChat: newEditorChat, openChat: openEditorChat },
    checkpoint: { revertUserMessage },
    scripts: { runFromHeader: runProjectScriptFromHeader },
  };
}
