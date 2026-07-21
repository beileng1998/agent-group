import type { TextHighlightListItem } from "@agent-group/contracts";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Textarea } from "~/components/ui/textarea";
import { CopyIcon, ExternalLinkIcon, PencilIcon, Trash2 } from "~/lib/icons";
import { cn } from "~/lib/utils";

function compactContext(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function HighlightExcerpt(props: { item: TextHighlightListItem; onJump: () => void }) {
  const marker = props.item.marker;
  const before = compactContext(marker.prefix ?? "");
  const after = compactContext(marker.suffix ?? "");
  const fullExcerpt = [before, marker.selectedText, after].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      disabled={!props.item.message.exists}
      title={props.item.message.exists ? fullExcerpt : "Source unavailable"}
      onClick={props.onJump}
      className="chat-markdown mt-1.5 block w-full text-left text-[13px] leading-5 text-[var(--color-text-foreground)] disabled:cursor-default"
    >
      <span className="line-clamp-4 whitespace-pre-wrap">
        {before ? (
          <span className="text-[var(--color-text-foreground-secondary)]">…{before} </span>
        ) : null}
        <span className={cn("thread-marker", `thread-marker-${marker.color}`)}>
          {marker.selectedText}
        </span>
        {after ? (
          <span className="text-[var(--color-text-foreground-secondary)]"> {after}…</span>
        ) : null}
      </span>
    </button>
  );
}

export function HighlightCard(props: {
  item: TextHighlightListItem;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  onJump: () => void;
  onRemove: () => void;
  onSaveNote: (note: string | null) => void;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(props.item.marker.note ?? "");

  useEffect(() => {
    if (!editingNote) setNoteDraft(props.item.marker.note ?? "");
  }, [editingNote, props.item.marker.note]);

  const saveNote = () => {
    props.onSaveNote(noteDraft.trim() || null);
    setEditingNote(false);
  };

  return (
    <article className="group/highlight border-b border-[var(--color-border-light)] px-3 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--color-background-elevated-secondary)]">
      <div className="flex items-start gap-2.5">
        <Checkbox
          checked={props.selected}
          onCheckedChange={(checked) => props.onSelectedChange(checked === true)}
          aria-label="Select highlight"
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--color-text-foreground-tertiary)]">
            <span className="truncate">{props.item.group.title}</span>
            <span aria-hidden>›</span>
            <span className="truncate text-[var(--color-text-foreground-secondary)]">
              {props.item.session.title}
            </span>
            {!props.item.message.exists ? (
              <span className="ml-auto shrink-0">Source unavailable</span>
            ) : null}
          </div>

          <HighlightExcerpt item={props.item} onJump={props.onJump} />

          {editingNote ? (
            <div className="mt-2 space-y-1.5">
              <Textarea
                size="sm"
                rows={3}
                value={noteDraft}
                maxLength={16_384}
                placeholder="Add an optional Markdown note…"
                onChange={(event) => setNoteDraft(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    saveNote();
                  } else if (event.key === "Escape") {
                    setNoteDraft(props.item.marker.note ?? "");
                    setEditingNote(false);
                  }
                }}
              />
              <div className="flex justify-end gap-1">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setNoteDraft(props.item.marker.note ?? "");
                    setEditingNote(false);
                  }}
                >
                  Cancel
                </Button>
                <Button size="xs" onClick={saveNote}>
                  Save
                </Button>
              </div>
            </div>
          ) : props.item.marker.note ? (
            <button
              type="button"
              onClick={() => setEditingNote(true)}
              className="mt-1.5 flex w-full items-start gap-1.5 text-left text-[11px] leading-4 text-[var(--color-text-foreground-secondary)] hover:text-[var(--color-text-foreground)]"
            >
              <PencilIcon className="mt-0.5 size-3 shrink-0" />
              <span className="line-clamp-2 whitespace-pre-wrap">{props.item.marker.note}</span>
            </button>
          ) : null}

          <div className="mt-1.5 flex items-center gap-0.5 text-[var(--color-text-foreground-secondary)]">
            <Button
              size="xs"
              variant="ghost"
              disabled={!props.item.message.exists}
              onClick={props.onJump}
            >
              <ExternalLinkIcon /> Jump
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void navigator.clipboard.writeText(props.item.marker.selectedText)}
            >
              <CopyIcon /> Copy
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setEditingNote(true)}>
              <PencilIcon /> {props.item.marker.note ? "Edit note" : "Add note"}
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Remove highlight"
              className="ml-auto opacity-50 transition-opacity hover:text-[var(--color-text-danger)] group-hover/highlight:opacity-100 focus-visible:opacity-100"
              onClick={props.onRemove}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}
