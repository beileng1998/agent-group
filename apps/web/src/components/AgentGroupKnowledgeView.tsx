// Renders the latest Knowledge cards at the bottom of the main Session transcript.

import {
  type AgentGroupKnowledgeAcknowledgement,
  type AgentGroupKnowledgeLink,
  type AgentGroupSessionDocument,
  ThreadMarkerId,
  type ThreadId,
} from "@agent-group/contracts";
import type {
  LearningContextCard,
  LearningContextProjection,
} from "@agent-group/shared/learningContext";
import { useMemo, useRef, useState, type MouseEvent } from "react";

import {
  buildKnowledgeLinkMarkers,
  type VisibleKnowledgeLink,
} from "~/lib/knowledgeCardLinks";
import { cn } from "~/lib/utils";
import { getSidechatCreator } from "~/lib/sidechatCreatorRegistry";
import { makeLearningOrigin } from "~/lib/knowledgeSidechat";
import {
  CheckIcon,
  CircleCheckIcon,
  GitBranchIcon,
  MessageCircleIcon,
  RefreshCwIcon,
} from "~/lib/icons";
import { readNativeApi } from "~/nativeApi";
import {
  resolveTranscriptMarkerRange,
  resolveTranscriptSelectionSourceRange,
} from "./chat/chatSelectionActions";
import ChatMarkdown from "./ChatMarkdown";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";

interface AgentGroupKnowledgeViewProps {
  document: AgentGroupSessionDocument;
  projection: LearningContextProjection;
  links: readonly VisibleKnowledgeLink[];
  onDocumentChange: (document: AgentGroupSessionDocument) => void;
  onOpenLink: (link: VisibleKnowledgeLink) => void;
  /** Defaults to the transcript-footer chrome; embedded surfaces can restyle or hide it. */
  className?: string;
  showHeader?: boolean;
}

interface CardSelection {
  text: string;
  startOffset: number | null;
  endOffset: number | null;
}

type CardStatus = "unlearned" | "learned" | "updated";

export function AgentGroupKnowledgeView(props: AgentGroupKnowledgeViewProps) {
  const knowledgeLead = visibleMarkdown(props.projection.knowledgeLead);
  const acknowledgements = props.document.session.knowledgeAcknowledgements ?? [];
  const learnedCount = props.projection.cards.filter(
    (card) => knowledgeCardStatus(card, acknowledgements) === "learned",
  ).length;

  return (
    <section
      data-session-knowledge-footer="true"
      className={cn(
        "w-full",
        props.className ?? "mx-auto mt-8 max-w-[46rem] border-t border-border/70 pt-5",
      )}
    >
      {props.showHeader !== false ? (
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Knowledge</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              The latest cards from this Session. Select a passage to explore it in Side.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
            {learnedCount}/{props.projection.cards.length} learned
          </span>
        </div>
      ) : null}

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
            links={props.links.filter((target) => target.link.cardKey === card.key)}
            onDocumentChange={props.onDocumentChange}
            onOpenLink={props.onOpenLink}
          />
        ))}
      </div>
    </section>
  );
}

function KnowledgeCard(props: {
  card: LearningContextCard;
  document: AgentGroupSessionDocument;
  links: readonly VisibleKnowledgeLink[];
  onDocumentChange: (document: AgentGroupSessionDocument) => void;
  onOpenLink: (link: VisibleKnowledgeLink) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<CardSelection | null>(null);
  const [marking, setMarking] = useState(false);
  const [asking, setAsking] = useState(false);
  const status = useMemo(
    () => knowledgeCardStatus(props.card, props.document.session.knowledgeAcknowledgements ?? []),
    [props.card, props.document.session.knowledgeAcknowledgements],
  );
  const markerTargets = useMemo(
    () =>
      buildKnowledgeLinkMarkers({
        cardKey: props.card.key,
        cardBody: props.card.body,
        links: props.links,
      }),
    [props.card.body, props.card.key, props.links],
  );
  const markerTargetById = useMemo(
    () => new Map(markerTargets.map((entry) => [entry.marker.id, entry.target])),
    [markerTargets],
  );

  const captureSelection = () => {
    const browserSelection = window.getSelection();
    if (
      !browserSelection ||
      browserSelection.isCollapsed ||
      !browserSelection.rangeCount ||
      !contentRef.current
    ) {
      setSelection(null);
      return;
    }
    const range = browserSelection.getRangeAt(0);
    if (!contentRef.current.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }
    const text = browserSelection.toString().trim();
    if (!text) {
      setSelection(null);
      return;
    }
    const exactRange =
      resolveTranscriptSelectionSourceRange(range, contentRef.current) ??
      resolveTranscriptMarkerRange({ messageText: props.card.body, selectedText: text });
    setSelection({
      text,
      startOffset: exactRange?.startOffset ?? null,
      endOffset: exactRange?.endOffset ?? null,
    });
  };

  const openLinkedMarker = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    const marker = event.target.closest<HTMLElement>("[data-thread-marker-id]");
    const markerId = marker?.dataset.threadMarkerId;
    const target = markerId ? markerTargetById.get(ThreadMarkerId.makeUnsafe(markerId)) : undefined;
    if (!target) return;
    event.preventDefault();
    props.onOpenLink(target);
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
    const source = makeLearningOrigin({
      sourceSessionId: props.document.session.sessionId,
      sourceContextRevision: props.document.contextRevision,
      cardKey: props.card.key,
      cardTitle: props.card.title,
      cardMarkdown: props.card.markdown,
      selectedText: selection?.text ?? null,
      selectionStartOffset: selection?.startOffset ?? null,
      selectionEndOffset: selection?.endOffset ?? null,
    });
    let targetThreadId: ThreadId | null = null;
    setAsking(true);
    try {
      await createSidechat({
        knowledgeSource: source,
        onCreated: (threadId) => {
          targetThreadId = threadId;
        },
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not open Side",
        description: error instanceof Error ? error.message : undefined,
      });
      setAsking(false);
      return;
    }

    try {
      if (!targetThreadId) throw new Error("The new Side could not be identified.");
      const link: AgentGroupKnowledgeLink = {
        targetThreadId,
        sourceContextRevision: props.document.contextRevision,
        cardKey: props.card.key,
        cardTitle: props.card.title,
        selectedText: selection?.text ?? null,
        selectionStartOffset: selection?.startOffset ?? null,
        selectionEndOffset: selection?.endOffset ?? null,
        createdAt: new Date().toISOString(),
      };
      props.onDocumentChange(await appendKnowledgeLink(props.document, link));
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch (error) {
      toastManager.add({
        type: "warning",
        title: "Side opened, but its card link could not be saved",
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
            title={selection ? "Ask about the selected passage" : "Ask about this card"}
            onClick={() => void askInSide()}
          >
            <MessageCircleIcon className="size-3.5" />
            {selection ? "Ask selection" : "Ask in Side"}
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
        data-knowledge-card-content="true"
        className="px-4 py-3 selection:bg-amber-200/60 [&_.thread-marker]:cursor-pointer dark:selection:bg-amber-500/30"
        onClick={openLinkedMarker}
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
      >
        {props.card.body ? (
          <ChatMarkdown
            text={props.card.body}
            cwd={props.document.workspaceRoot}
            isStreaming={false}
            markers={markerTargets.map((entry) => entry.marker)}
            className="text-[length:var(--app-font-size-chat,12px)] leading-relaxed"
          />
        ) : (
          <p className="text-xs text-muted-foreground">This card is waiting for an explanation.</p>
        )}
      </div>
      {props.links.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-4 py-2">
          <span className="mr-1 text-[10px] text-muted-foreground">Related</span>
          {props.links.map((target) => (
            <Button
              key={`${target.link.targetThreadId}:${target.link.cardKey}`}
              variant="ghost"
              size="xs"
              title={`Open ${target.kind === "side" ? "Side" : "child session"}: ${target.title}`}
              onClick={() => props.onOpenLink(target)}
            >
              {target.kind === "side" ? (
                <MessageCircleIcon className="size-3.5" />
              ) : (
                <GitBranchIcon className="size-3.5" />
              )}
              <span className="max-w-44 truncate">
                {target.kind === "side" ? "Side" : "Child"} · {target.title}
              </span>
            </Button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

async function appendKnowledgeLink(
  document: AgentGroupSessionDocument,
  link: AgentGroupKnowledgeLink,
): Promise<AgentGroupSessionDocument> {
  const api = readNativeApi();
  if (!api) throw new Error("The Agent Group service is unavailable.");
  try {
    return await api.agentGroup.updateSession({
      sessionId: document.session.sessionId,
      knowledgeLink: link,
      expectedRevision: document.config.revision,
    });
  } catch {
    const latest = await api.agentGroup.getSession({ sessionId: document.session.sessionId });
    return api.agentGroup.updateSession({
      sessionId: latest.session.sessionId,
      knowledgeLink: link,
      expectedRevision: latest.config.revision,
    });
  }
}

export function knowledgeCardStatus(
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
