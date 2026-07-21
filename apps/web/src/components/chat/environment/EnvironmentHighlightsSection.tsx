// FILE: EnvironmentHighlightsSection.tsx
// Purpose: Unified Environment preview for whole-message pins and text highlights.

import type {
  MessageId,
  PinnedMessage,
  ThreadMarker,
  ThreadMarkerId,
} from "@agent-group/contracts";

import { ArrowRightIcon } from "~/lib/icons";

import { EnvironmentHighlightRow } from "./EnvironmentMarkersSection";
import { EnvironmentPinnedMessageRow } from "./EnvironmentPinnedSection";
import { EnvironmentCollapsibleSection } from "./EnvironmentRow";

const PREVIEW_LIMIT_PER_KIND = 3;

export function EnvironmentHighlightsSection(props: {
  pins: readonly PinnedMessage[];
  markers: readonly ThreadMarker[];
  pinnedMessageTextById: ReadonlyMap<MessageId, string>;
  markerMessageTextById: ReadonlyMap<MessageId, string>;
  onJumpToPin: (messageId: MessageId) => void;
  onTogglePinDone: (messageId: MessageId) => void;
  onUnpin: (messageId: MessageId) => void;
  onRenamePin: (messageId: MessageId, label: string | null) => void;
  onJumpToMarker: (marker: ThreadMarker) => void;
  onRemoveMarker: (markerId: ThreadMarkerId) => void;
  onViewAll: (() => void) | null;
}) {
  const total = props.pins.length + props.markers.length;
  if (total === 0) return null;

  return (
    <EnvironmentCollapsibleSection label="Highlights">
      <ul className="flex flex-col gap-0.5">
        {props.pins.slice(0, PREVIEW_LIMIT_PER_KIND).map((pin) => (
          <EnvironmentPinnedMessageRow
            key={`pin:${pin.messageId}`}
            pin={pin}
            text={props.pinnedMessageTextById.get(pin.messageId)}
            onJump={props.onJumpToPin}
            onToggleDone={props.onTogglePinDone}
            onUnpin={props.onUnpin}
            onRename={props.onRenamePin}
          />
        ))}
        {props.markers.slice(0, PREVIEW_LIMIT_PER_KIND).map((marker) => (
          <EnvironmentHighlightRow
            key={`highlight:${marker.id}`}
            marker={marker}
            text={props.markerMessageTextById.get(marker.messageId)}
            onJump={props.onJumpToMarker}
            onRemove={props.onRemoveMarker}
          />
        ))}
      </ul>
      {props.onViewAll ? (
        <button
          type="button"
          onClick={props.onViewAll}
          className="mt-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[length:var(--app-font-size-ui-sm,11px)] text-[var(--color-text-foreground-secondary)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)]"
        >
          <span>View all {total} saved items</span>
          <ArrowRightIcon className="size-3.5" />
        </button>
      ) : null}
    </EnvironmentCollapsibleSection>
  );
}
