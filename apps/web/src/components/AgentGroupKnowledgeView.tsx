// Renders the derived Knowledge-card view while context.md remains canonical.

import type {
  AgentGroupKnowledgeAcknowledgement,
  AgentGroupSessionDocument,
} from "@agent-group/contracts";
import type {
  LearningContextCard,
  LearningContextProjection,
} from "@agent-group/shared/learningContext";
import { useMemo, useRef, useState } from "react";

import { getSidechatCreator } from "~/lib/sidechatCreatorRegistry";
import { makeLearningOrigin } from "~/lib/knowledgeSidechat";
import {
  CheckIcon,
  CircleCheckIcon,
  MessageCircleIcon,
  RefreshCwIcon,
} from "~/lib/icons";
import { readNativeApi } from "~/nativeApi";
import { toastManager } from "./ui/toast";
import ChatMarkdown from "./ChatMarkdown";
import { Button } from "./ui/button";

interface AgentGroupKnowledgeViewProps {
  document: AgentGroupSessionDocument;
  projection: LearningContextProjection;
  onDocumentChange: (document: AgentGroupSessionDocument) => void;
}

type CardStatus = "unlearned" | "learned" | "updated";

export function AgentGroupKnowledgeView(props: AgentGroupKnowledgeViewProps) {
  const goal = visibleMarkdown(props.projection.goal);
  const knowledgeLead = visibleMarkdown(props.projection.knowledgeLead);
  const state = visibleMarkdown(props.projection.state);
  const learnedCount = props.projection.cards.filter(
    (card) => cardStatus(card, props.document.session.knowledgeAcknowledgements) === "learned",
  ).length;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-muted/15 px-4 py-3">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Goal
        </div>
        {goal ? (
          <ChatMarkdown
            text={goal}
            cwd={props.document.workspaceRoot}
            isStreaming={false}
            className="mt-2 text-[length:var(--app-font-size-chat,12px)] leading-relaxed"
          />
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">The learning goal is not written yet.</p>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Knowledge</h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Select a passage to take only that part into Side.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
            {learnedCount}/{props.projection.cards.length} learned
          </span>
        </div>

        {knowledgeLead ? (
          <ChatMarkdown
            text={knowledgeLead}
            cwd={props.document.workspaceRoot}
            isStreaming={false}
            className="mb-3 text-[length:var(--app-font-size-chat,12px)] leading-relaxed"
          />
        ) : null}

        <div className="space-y-3">
          {props.projection.cards.map((card) => (
            <KnowledgeCard
              key={card.key}
              card={card}
              document={props.document}
              onDocumentChange={props.onDocumentChange}
            />
          ))}
          {props.projection.cards.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
              Knowledge cards will grow here as the conversation develops.
            </div>
          ) : null}
        </div>
      </section>

      <section className="border-t border-border pt-4">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          State
        </div>
        {state ? (
          <ChatMarkdown
            text={state}
            cwd={props.document.workspaceRoot}
            isStreaming={false}
            className="mt-2 text-[length:var(--app-font-size-chat,12px)] leading-relaxed"
          />
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No open learning state.</p>
        )}
      </section>

      {props.projection.otherContext ? (
        <section className="border-t border-border pt-4">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Other context
          </div>
          <ChatMarkdown
            text={props.projection.otherContext}
            cwd={props.document.workspaceRoot}
            isStreaming={false}
            className="text-[length:var(--app-font-size-chat,12px)] leading-relaxed"
          />
        </section>
      ) : null}
    </div>
  );
}

function KnowledgeCard(props: {
  card: LearningContextCard;
  document: AgentGroupSessionDocument;
  onDocumentChange: (document: AgentGroupSessionDocument) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [asking, setAsking] = useState(false);
  const status = useMemo(
    () => cardStatus(props.card, props.document.session.knowledgeAcknowledgements),
    [props.card, props.document.session.knowledgeAcknowledgements],
  );

  const captureSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !contentRef.current) {
      setSelectedText(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!contentRef.current.contains(range.commonAncestorContainer)) {
      setSelectedText(null);
      return;
    }
    setSelectedText(selection.toString().trim() || null);
  };

  const markLearned = async () => {
    if (marking || status === "learned") return;
    const api = readNativeApi();
    if (!api) return;
    setMarking(true);
    try {
      const document = await api.agentGroup.updateSession({
        sessionId: props.document.session.sessionId,
        knowledgeAcknowledgement: {
          cardKey: props.card.key,
          cardMarkdown: props.card.markdown,
          acknowledgedAt: new Date().toISOString(),
        },
        expectedRevision: props.document.config.revision,
      });
      props.onDocumentChange(document);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not update learning progress",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setMarking(false);
    }
  };

  const askInSide = async () => {
    if (asking) return;
    const createSidechat = getSidechatCreator(props.document.session.sessionId);
    if (!createSidechat) {
      toastManager.add({
        type: "warning",
        title: "Side is unavailable",
        description: "Open this Session as the active chat before asking in Side.",
      });
      return;
    }
    setAsking(true);
    try {
      await createSidechat({
        knowledgeSource: makeLearningOrigin({
          sourceSessionId: props.document.session.sessionId,
          sourceContextRevision: props.document.contextRevision,
          cardKey: props.card.key,
          cardTitle: props.card.title,
          cardMarkdown: props.card.markdown,
          selectedText,
        }),
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not open Side",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setAsking(false);
    }
  };

  return (
    <article className="rounded-xl border border-border bg-background/45 shadow-xs">
      <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-5">{props.card.title}</h3>
          {status === "updated" ? (
            <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
              <RefreshCwIcon className="size-3" /> Updated since you learned it
            </div>
          ) : status === "learned" ? (
            <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
              <CircleCheckIcon className="size-3" /> Learned
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            disabled={asking}
            title={selectedText ? "Ask about the selected passage" : "Ask about this card"}
            onClick={() => void askInSide()}
          >
            <MessageCircleIcon className="size-3.5" />
            {selectedText ? "Ask selection" : "Ask in Side"}
          </Button>
          <Button
            variant={status === "learned" ? "secondary" : "outline"}
            size="xs"
            disabled={marking || status === "learned"}
            onClick={() => void markLearned()}
          >
            <CheckIcon className="size-3.5" />
            {status === "learned"
              ? "Learned"
              : status === "updated"
                ? "Mark reviewed"
                : "Mark learned"}
          </Button>
        </div>
      </div>
      <div
        ref={contentRef}
        className="px-4 py-3 selection:bg-amber-200/60 dark:selection:bg-amber-500/30"
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
      >
        {props.card.body ? (
          <ChatMarkdown
            text={props.card.body}
            cwd={props.document.workspaceRoot}
            isStreaming={false}
            className="text-[length:var(--app-font-size-chat,12px)] leading-relaxed"
          />
        ) : (
          <p className="text-xs text-muted-foreground">This card is waiting for an explanation.</p>
        )}
      </div>
    </article>
  );
}

function cardStatus(
  card: LearningContextCard,
  acknowledgements: readonly AgentGroupKnowledgeAcknowledgement[],
): CardStatus {
  const history = acknowledgements.filter((item) => item.cardKey === card.key);
  if (history.some((item) => item.cardMarkdown === card.markdown)) return "learned";
  return history.length > 0 ? "updated" : "unlearned";
}

function visibleMarkdown(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "").trim();
}
