// Shows the Session's Knowledge cards above the managed agent terminal, capped at half height.

import type { ThreadId } from "@agent-group/contracts";
import { useState } from "react";

import { useAgentGroupKnowledge } from "~/hooks/useAgentGroupKnowledge";
import { disclosureChevronClassName } from "~/lib/disclosureMotion";
import { ChevronRightIcon } from "~/lib/icons";
import { AgentGroupKnowledgeView, knowledgeCardStatus } from "./AgentGroupKnowledgeView";
import { DisclosureRegion } from "./ui/DisclosureRegion";

export function AgentGroupTerminalKnowledgePanel(props: {
  sessionId: ThreadId;
  threadUpdatedAt?: string | undefined;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const { document, setDocument, projection, links, openLink } = useAgentGroupKnowledge(props);
  const [open, setOpen] = useState(true);

  if (!document || !projection || projection.cards.length === 0) return null;

  const acknowledgements = document.session.knowledgeAcknowledgements ?? [];
  const learnedCount = projection.cards.filter(
    (card) => knowledgeCardStatus(card, acknowledgements) === "learned",
  ).length;

  return (
    <div className="flex max-h-[50%] shrink-0 flex-col border-b border-border/70 bg-[var(--color-background-surface)]">
      <button
        type="button"
        aria-expanded={open}
        className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRightIcon className={disclosureChevronClassName(open)} />
        Knowledge
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {learnedCount}/{projection.cards.length} learned
        </span>
      </button>
      <DisclosureRegion open={open} className="min-h-0" contentClassName="h-full min-h-0">
        <div className="h-full overflow-y-auto px-3 pb-3">
          <AgentGroupKnowledgeView
            document={document}
            projection={projection}
            links={links}
            onDocumentChange={setDocument}
            onOpenLink={openLink}
            showHeader={false}
            className="mx-auto max-w-[46rem]"
          />
        </div>
      </DisclosureRegion>
    </div>
  );
}
