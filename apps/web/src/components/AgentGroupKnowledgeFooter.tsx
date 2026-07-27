// Mounts the latest context.md Knowledge projection as the transcript footer.

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
import { AgentGroupKnowledgeView } from "./AgentGroupKnowledgeView";

export function AgentGroupKnowledgeFooter(props: {
  sessionId: ThreadId;
  threadUpdatedAt?: string | undefined;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const { document, setDocument } = useAgentGroupSessionDocument({
    sessionId: props.sessionId,
    threadUpdatedAt: props.threadUpdatedAt,
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
            links: document.session.knowledgeLinks,
            sourceSessionId: document.session.sessionId,
            summaries,
          })
        : [],
    [document, summaries],
  );
  const openLink = useCallback(
    (target: VisibleKnowledgeLink) => {
      if (target.kind === "side") {
        useRightDockStore.getState().openPane(props.sessionId, {
          kind: "sidechat",
          threadId: target.link.targetThreadId,
        });
        return;
      }
      props.onOpenThread(target.link.targetThreadId);
    },
    [props.onOpenThread, props.sessionId],
  );

  if (!document || !projection || projection.cards.length === 0) return null;

  return (
    <AgentGroupKnowledgeView
      document={document}
      projection={projection}
      links={links}
      onDocumentChange={setDocument}
      onOpenLink={openLink}
    />
  );
}
