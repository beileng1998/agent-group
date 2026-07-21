// FILE: EnvironmentMarkersSection.tsx
// Purpose: Compact current-session Highlight preview in the Environment panel.

import type { MessageId, ThreadMarker, ThreadMarkerId } from "@agent-group/contracts";
import { isThreadMarkerAvailable } from "@agent-group/shared/threadMarkers";
import { memo } from "react";

import { IconButton } from "~/components/ui/icon-button";
import { ArrowRightIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { deriveThreadMarkerLabel } from "~/threadMarkers";

import { MARKER_SWATCH_CLASS } from "../markerColors";
import { EnvironmentCollapsibleSection } from "./EnvironmentRow";

interface EnvironmentMarkersSectionProps {
  markers: readonly ThreadMarker[];
  messageTextById: ReadonlyMap<MessageId, string>;
  onJump: (marker: ThreadMarker) => void;
  onRemove: (markerId: ThreadMarkerId) => void;
  onViewAll: (() => void) | null;
}

const PREVIEW_LIMIT = 5;

export function EnvironmentMarkersSection(props: EnvironmentMarkersSectionProps) {
  if (props.markers.length === 0) return null;
  return (
    <EnvironmentCollapsibleSection label="Highlights">
      <ul className="flex flex-col gap-0.5">
        {props.markers.slice(0, PREVIEW_LIMIT).map((marker) => (
          <EnvironmentHighlightRow
            key={marker.id}
            marker={marker}
            text={props.messageTextById.get(marker.messageId)}
            onJump={props.onJump}
            onRemove={props.onRemove}
          />
        ))}
      </ul>
      {props.onViewAll ? (
        <button
          type="button"
          onClick={props.onViewAll}
          className="mt-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[length:var(--app-font-size-ui-sm,11px)] text-[var(--color-text-foreground-secondary)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)]"
        >
          <span>View all {props.markers.length} highlights</span>
          <ArrowRightIcon className="size-3.5" />
        </button>
      ) : null}
    </EnvironmentCollapsibleSection>
  );
}

export const EnvironmentHighlightRow = memo(function EnvironmentHighlightRow(props: {
  marker: ThreadMarker;
  text: string | undefined;
  onJump: (marker: ThreadMarker) => void;
  onRemove: (markerId: ThreadMarkerId) => void;
}) {
  const available = props.text !== undefined && isThreadMarkerAvailable(props.marker, props.text);
  return (
    <li className="group/highlight flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--color-background-elevated-secondary)]">
      <span
        aria-hidden
        className={cn(
          "mt-1 size-2.5 shrink-0 rounded-full",
          MARKER_SWATCH_CLASS[props.marker.color],
        )}
      />
      <button
        type="button"
        disabled={!available}
        onClick={() => props.onJump(props.marker)}
        title={available ? "Jump to highlight" : "Source message is unavailable"}
        className="min-w-0 flex-1 text-left disabled:cursor-default"
      >
        <span
          className={cn(
            "block truncate text-[length:var(--app-font-size-ui,12px)]",
            available
              ? "text-[var(--color-text-foreground)]"
              : "text-[var(--color-text-foreground-tertiary)]",
          )}
        >
          {deriveThreadMarkerLabel(props.marker)}
        </span>
        {props.marker.note ? (
          <span className="mt-0.5 block line-clamp-2 text-[10px] leading-relaxed text-[var(--color-text-foreground-secondary)]">
            {props.marker.note}
          </span>
        ) : null}
      </button>
      <IconButton
        label="Remove highlight"
        tooltip="Remove"
        size="icon-xs"
        className="shrink-0 opacity-0 transition-opacity group-hover/highlight:opacity-100 focus-visible:opacity-100"
        onClick={() => props.onRemove(props.marker.id)}
      >
        <XIcon className="size-3" />
      </IconButton>
    </li>
  );
});
