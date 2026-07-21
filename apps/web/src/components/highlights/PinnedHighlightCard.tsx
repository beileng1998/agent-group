import {
  PINNED_MESSAGE_LABEL_MAX_CHARS,
  type PinnedHighlightListItem,
} from "@agent-group/contracts";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { CopyIcon, ExternalLinkIcon, PencilIcon, Trash2 } from "~/lib/icons";
import { PinStatusIcon } from "~/lib/pin";
import { cn } from "~/lib/utils";

export function PinnedHighlightCard(props: {
  item: PinnedHighlightListItem;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  onJump: () => void;
  onRemove: () => void;
  onToggleDone: () => void;
  onSaveLabel: (label: string | null) => void;
}) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(props.item.pin.label ?? "");
  const available = props.item.message.exists;

  useEffect(() => {
    if (!editingLabel) setLabelDraft(props.item.pin.label ?? "");
  }, [editingLabel, props.item.pin.label]);

  const saveLabel = () => {
    props.onSaveLabel(labelDraft.trim() || null);
    setEditingLabel(false);
  };

  return (
    <article
      className={cn(
        "group/highlight border-b border-[var(--color-border-light)] px-3 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--color-background-elevated-secondary)]",
        props.item.pin.done && "opacity-65",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Checkbox
          checked={props.selected}
          onCheckedChange={(checked) => props.onSelectedChange(checked === true)}
          aria-label="Select pinned message"
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--color-text-foreground-tertiary)]">
            <PinStatusIcon pinned className="size-3 shrink-0" />
            <span className="shrink-0 font-medium text-[var(--color-text-foreground-secondary)]">
              Pinned
            </span>
            <span aria-hidden>·</span>
            <span className="truncate">{props.item.group.title}</span>
            <span aria-hidden>›</span>
            <span className="truncate text-[var(--color-text-foreground-secondary)]">
              {props.item.session.title}
            </span>
          </div>

          {editingLabel ? (
            <div className="mt-2 flex items-center gap-1.5">
              <input
                autoFocus
                value={labelDraft}
                maxLength={PINNED_MESSAGE_LABEL_MAX_CHARS}
                placeholder="Add a label"
                onChange={(event) => setLabelDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveLabel();
                  } else if (event.key === "Escape") {
                    setEditingLabel(false);
                  }
                }}
                className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
              />
              <Button size="xs" onClick={saveLabel}>
                Save
              </Button>
            </div>
          ) : props.item.pin.label ? (
            <button
              type="button"
              onClick={() => setEditingLabel(true)}
              className={cn(
                "mt-1.5 block w-full truncate text-left text-[13px] font-medium text-[var(--color-text-foreground)]",
                props.item.pin.done && "line-through",
              )}
            >
              {props.item.pin.label}
            </button>
          ) : null}

          <button
            type="button"
            disabled={!available}
            title={available ? "Jump to pinned message" : "Source unavailable"}
            onClick={props.onJump}
            className={cn(
              "mt-1.5 block w-full text-left text-[13px] leading-5 text-[var(--color-text-foreground)] disabled:cursor-default",
              props.item.pin.done && "line-through",
            )}
          >
            <span className="line-clamp-5 whitespace-pre-wrap break-words">
              {available ? props.item.message.text : "Source unavailable"}
            </span>
          </button>

          <div className="mt-1.5 flex items-center gap-0.5 text-[var(--color-text-foreground-secondary)]">
            <Button size="xs" variant="ghost" disabled={!available} onClick={props.onJump}>
              <ExternalLinkIcon /> Jump
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={!available}
              onClick={() => void navigator.clipboard.writeText(props.item.message.text)}
            >
              <CopyIcon /> Copy
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setEditingLabel(true)}>
              <PencilIcon /> {props.item.pin.label ? "Edit label" : "Add label"}
            </Button>
            <Button size="xs" variant="ghost" onClick={props.onToggleDone}>
              {props.item.pin.done ? "Reopen" : "Done"}
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Unpin message"
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
