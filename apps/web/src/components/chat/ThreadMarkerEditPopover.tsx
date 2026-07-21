// FILE: ThreadMarkerEditPopover.tsx
// Purpose: Floating editor for an existing highlight marker (recolor / remove).
// Layer: Chat transcript interaction UI

import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadMarkerColor } from "@agent-group/contracts";
import { XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { MARKER_COLORS, MARKER_SWATCH_CLASS } from "./markerColors";

interface ThreadMarkerEditPopoverProps {
  color: ThreadMarkerColor;
  note: string | null;
  anchorRect: DOMRect;
  onColorChange: (color: ThreadMarkerColor) => void;
  onNoteChange: (note: string | null) => void;
  onRemove: () => void;
  onClose: () => void;
}

// Popover height + gap, used to place it above the marker (or below when cramped).
const POPOVER_GAP_PX = 8;
const POPOVER_HEIGHT_PX = 176;

export function ThreadMarkerEditPopover(props: ThreadMarkerEditPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState(props.note ?? "");
  const noteRef = useRef(note);
  noteRef.current = note;
  const saveNote = useCallback(() => {
    const next = noteRef.current.trim();
    if (next !== (props.note ?? "")) props.onNoteChange(next || null);
  }, [props.note, props.onNoteChange]);

  // Close on outside pointerdown, Escape, or any scroll (the anchor is inside a
  // virtualized list, so tracking it on scroll is not worth the churn).
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        saveNote();
        props.onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [props.onClose, saveNote]);

  const placeBelow = props.anchorRect.top < POPOVER_HEIGHT_PX + POPOVER_GAP_PX + 8;
  const top = placeBelow
    ? props.anchorRect.bottom + POPOVER_GAP_PX
    : props.anchorRect.top - POPOVER_HEIGHT_PX - POPOVER_GAP_PX;
  // Center on the marker's midpoint, clamped so the popover stays on screen.
  const halfWidth = 160;
  const left = Math.min(
    Math.max(halfWidth + 8, props.anchorRect.left + props.anchorRect.width / 2),
    window.innerWidth - halfWidth - 8,
  );

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Edit highlight"
      className="pointer-events-auto fixed z-50 -translate-x-1/2"
      style={{ top, left }}
    >
      <div
        className={cn(
          "w-80 rounded-xl border border-[color:var(--color-border)] bg-[var(--color-background-elevated-primary-opaque)] p-2.5 shadow-xl backdrop-blur-xl",
          placeBelow ? "origin-top" : "origin-bottom",
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {MARKER_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`${color} highlight`}
                aria-pressed={props.color === color}
                title={color}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  props.onColorChange(color);
                }}
                className={cn(
                  "size-5 rounded-full transition-transform hover:scale-110",
                  MARKER_SWATCH_CLASS[color],
                  props.color === color
                    ? "outline outline-2 outline-offset-2 outline-[var(--color-text-foreground)]"
                    : "",
                )}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Remove highlight"
            title="Remove"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onRemove();
            }}
            className="inline-flex h-6 items-center rounded-md px-1.5 text-[var(--color-text-foreground-secondary)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-danger)]"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
        <label className="mt-2 block text-[11px] font-medium text-[var(--color-text-foreground-secondary)]">
          Note
          <textarea
            value={note}
            maxLength={16_384}
            rows={4}
            placeholder="Add an optional Markdown note…"
            className="mt-1 block w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-background-surface)] px-2.5 py-2 text-xs font-normal leading-relaxed text-[var(--color-text-foreground)] outline-none placeholder:text-[var(--color-text-foreground-tertiary)] focus:border-[var(--color-border-accent)]"
            onChange={(event) => setNote(event.target.value)}
            onBlur={saveNote}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                saveNote();
                props.onClose();
              }
            }}
          />
        </label>
      </div>
    </div>
  );
}
