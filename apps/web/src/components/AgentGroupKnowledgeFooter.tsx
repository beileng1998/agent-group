// Mounts the latest context.md Knowledge projection as the transcript footer.

import type { ThreadId } from "@agent-group/contracts";

import { useAgentGroupKnowledge } from "~/hooks/useAgentGroupKnowledge";
import { AgentGroupKnowledgeView } from "./AgentGroupKnowledgeView";

export function AgentGroupKnowledgeFooter(props: {
  sessionId: ThreadId;
  threadUpdatedAt?: string | undefined;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const { document, setDocument, projection, links, openLink } = useAgentGroupKnowledge(props);

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
