// Loads the latest Knowledge projection and visible links for one Agent Group Session.

import type { ThreadId } from "@agent-group/contracts";
import { parseLearningContext } from "@agent-group/shared/learningContext";
import { useCallback, useMemo } from "react";

import { useAgentGroupSessionDocument } from "~/hooks/useAgentGroupSessionDocument";
import {
  resolveVisibleKnowledgeLinks,
  type VisibleKnowledgeLink,
} from "~/lib/knowledgeCardLinks";
import { useRightDockStore } from "~/rightDockStore";
import { useStore } from "~/store";

export function useAgentGroupKnowledge(input: {
  sessionId: ThreadId;
  threadUpdatedAt?: string | undefined;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const { document, setDocument } = useAgentGroupSessionDocument({
    sessionId: input.sessionId,
    threadUpdatedAt: input.threadUpdatedAt,
  });
  const summaries = useStore((state) => state.sidebarThreadSummaryById);
  const projection = useMemo(
    () => (document ? parseLearningContext(document.context) : null),
    [document],
  );
  const links = useMemo(
    () =>
      document
        ? resolveVisibleKnowledgeLinks({
            links: document.session.knowledgeLinks ?? [],
            sourceSessionId: document.session.sessionId,
            summaries,
          })
        : [],
    [document, summaries],
  );
  const openLink = useCallback(
    (target: VisibleKnowledgeLink) => {
      if (target.kind === "side") {
        useRightDockStore.getState().openPane(input.sessionId, {
          kind: "sidechat",
          threadId: target.link.targetThreadId,
        });
        return;
      }
      input.onOpenThread(target.link.targetThreadId);
    },
    [input.onOpenThread, input.sessionId],
  );

  return { document, setDocument, projection, links, openLink };
}
