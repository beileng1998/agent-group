// Renders the Session's Knowledge cards as a collapsible panel pinned above the workspace
// surface (chat transcript or managed agent terminal), capped at half height.

import type { ThreadId } from "@agent-group/contracts";
import { useCallback, useSyncExternalStore } from "react";

import { useAgentGroupKnowledge } from "~/hooks/useAgentGroupKnowledge";
import { disclosureChevronClassName } from "~/lib/disclosureMotion";
import { ChevronRightIcon } from "~/lib/icons";
import { AgentGroupKnowledgeView, knowledgeCardStatus } from "./AgentGroupKnowledgeView";
import { DisclosureRegion } from "./ui/DisclosureRegion";

const openByThreadId = new Map<ThreadId, boolean>();
const openListeners = new Set<() => void>();

function subscribePanelOpen(listener: () => void): () => void {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
}

/** Collapse state is keyed by Session so every mounted panel (chat, terminal, dock) agrees. */
function useKnowledgePanelOpen(sessionId: ThreadId): readonly [boolean, () => void] {
  const open = useSyncExternalStore(
    subscribePanelOpen,
    () => openByThreadId.get(sessionId) ?? true,
  );
  const toggle = useCallback(() => {
    openByThreadId.set(sessionId, !(openByThreadId.get(sessionId) ?? true));
    for (const listener of openListeners) listener();
  }, [sessionId]);
  return [open, toggle] as const;
}

export function AgentGroupKnowledgePanel(props: {
  sessionId: ThreadId;
  threadUpdatedAt?: string | undefined;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const { document, setDocument, projection, links, openLink } = useAgentGroupKnowledge(props);
  const [open, toggleOpen] = useKnowledgePanelOpen(props.sessionId);

  if (!document || !projection || projection.cards.length === 0) return null;

  const acknowledgements = document.session.knowledgeAcknowledgements ?? [];
  const learnedCount = projection.cards.filter(
    (card) => knowledgeCardStatus(card, acknowledgements) === "learned",
  ).length;

  return (
    <div className="flex max-h-[50%] shrink-0 flex-col overflow-hidden border-b border-border/70 bg-[var(--color-background-surface)]">
      <button
        type="button"
        aria-expanded={open}
        className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        onClick={toggleOpen}
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
