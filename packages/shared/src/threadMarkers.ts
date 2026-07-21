// FILE: threadMarkers.ts
// Purpose: Shared pure transforms for per-thread text markers.
// Layer: Shared runtime domain helper used by server projections and web state/actions.

import {
  THREAD_MARKER_LABEL_MAX_CHARS,
  THREAD_MARKER_NOTE_MAX_CHARS,
  type ThreadMarker,
  type ThreadMarkerColor,
  type ThreadMarkerId,
} from "@agent-group/contracts";

function keepExistingMarkers(markers: readonly ThreadMarker[]): ThreadMarker[] {
  return markers as ThreadMarker[];
}

function isSameMarkerRange(left: ThreadMarker, right: ThreadMarker): boolean {
  return (
    left.messageId === right.messageId &&
    left.startOffset === right.startOffset &&
    left.endOffset === right.endOffset &&
    left.style === right.style
  );
}

type ThreadMarkerRange = Pick<ThreadMarker, "messageId" | "startOffset" | "endOffset">;

export function doThreadMarkerRangesOverlap(
  left: ThreadMarkerRange,
  right: ThreadMarkerRange,
): boolean {
  return (
    left.messageId === right.messageId &&
    left.startOffset < right.endOffset &&
    right.startOffset < left.endOffset
  );
}

export function addThreadMarker(
  markers: readonly ThreadMarker[] | null | undefined,
  marker: ThreadMarker,
): ThreadMarker[] {
  const existingMarkers = markers ?? [];
  const retainedMarkers: ThreadMarker[] = [];
  for (const entry of existingMarkers) {
    if (entry.id === marker.id || isSameMarkerRange(entry, marker)) {
      return keepExistingMarkers(existingMarkers);
    }
    if (!doThreadMarkerRangesOverlap(entry, marker)) {
      retainedMarkers.push(entry);
    }
  }
  // Keep transcript rendering deterministic: overlapping markers are replaced instead of hidden.
  return retainedMarkers.length === existingMarkers.length
    ? [...existingMarkers, marker]
    : [...retainedMarkers, marker];
}

export function removeThreadMarker(
  markers: readonly ThreadMarker[] | null | undefined,
  markerId: ThreadMarkerId,
): ThreadMarker[] {
  const existingMarkers = markers ?? [];
  const nextMarkers = existingMarkers.filter((marker) => marker.id !== markerId);
  return nextMarkers.length === existingMarkers.length
    ? keepExistingMarkers(existingMarkers)
    : nextMarkers;
}

export function normalizeThreadMarkerLabel(label: string | null): string | null {
  const trimmed = label?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.length > THREAD_MARKER_LABEL_MAX_CHARS
    ? trimmed.slice(0, THREAD_MARKER_LABEL_MAX_CHARS)
    : trimmed;
}

export function setThreadMarkerDone(
  markers: readonly ThreadMarker[] | null | undefined,
  markerId: ThreadMarkerId,
  done: boolean,
  updatedAt: string,
): ThreadMarker[] {
  const existingMarkers = markers ?? [];
  let changed = false;
  const nextMarkers = existingMarkers.map((marker) => {
    if (marker.id !== markerId || marker.done === done) {
      return marker;
    }
    changed = true;
    return { ...marker, done, updatedAt };
  });
  return changed ? nextMarkers : keepExistingMarkers(existingMarkers);
}

export function setThreadMarkerLabel(
  markers: readonly ThreadMarker[] | null | undefined,
  markerId: ThreadMarkerId,
  label: string | null,
  updatedAt: string,
): ThreadMarker[] {
  const normalized = normalizeThreadMarkerLabel(label);
  const existingMarkers = markers ?? [];
  let changed = false;
  const nextMarkers = existingMarkers.map((marker) => {
    if (marker.id !== markerId || (marker.label ?? null) === normalized) {
      return marker;
    }
    changed = true;
    return { ...marker, label: normalized, updatedAt };
  });
  return changed ? nextMarkers : keepExistingMarkers(existingMarkers);
}

export function setThreadMarkerColor(
  markers: readonly ThreadMarker[] | null | undefined,
  markerId: ThreadMarkerId,
  color: ThreadMarkerColor,
  updatedAt: string,
): ThreadMarker[] {
  const existingMarkers = markers ?? [];
  let changed = false;
  const nextMarkers = existingMarkers.map((marker) => {
    if (marker.id !== markerId || marker.color === color) {
      return marker;
    }
    changed = true;
    return { ...marker, color, updatedAt };
  });
  return changed ? nextMarkers : keepExistingMarkers(existingMarkers);
}

export function normalizeThreadMarkerNote(note: string | null): string | null {
  const trimmed = note?.trim() ?? "";
  if (trimmed.length === 0) return null;
  return trimmed.length > THREAD_MARKER_NOTE_MAX_CHARS
    ? trimmed.slice(0, THREAD_MARKER_NOTE_MAX_CHARS)
    : trimmed;
}

export function setThreadMarkerNote(
  markers: readonly ThreadMarker[] | null | undefined,
  markerId: ThreadMarkerId,
  note: string | null,
  updatedAt: string,
): ThreadMarker[] {
  const normalized = normalizeThreadMarkerNote(note);
  const existingMarkers = markers ?? [];
  let changed = false;
  const nextMarkers = existingMarkers.map((marker) => {
    if (marker.id !== markerId || (marker.note ?? null) === normalized) return marker;
    changed = true;
    return { ...marker, note: normalized, updatedAt };
  });
  return changed ? nextMarkers : keepExistingMarkers(existingMarkers);
}

export interface ResolvedThreadMarkerRange {
  readonly startOffset: number;
  readonly endOffset: number;
}

export function resolveThreadMarkerRange(
  marker: ThreadMarker,
  messageText: string,
): ResolvedThreadMarkerRange | null {
  const exact = marker.selectedText;
  if (
    marker.startOffset >= 0 &&
    marker.endOffset > marker.startOffset &&
    marker.endOffset <= messageText.length &&
    messageText.slice(marker.startOffset, marker.endOffset) === exact
  ) {
    return { startOffset: marker.startOffset, endOffset: marker.endOffset };
  }

  const candidates: ResolvedThreadMarkerRange[] = [];
  let searchFrom = 0;
  while (searchFrom <= messageText.length - exact.length) {
    const startOffset = messageText.indexOf(exact, searchFrom);
    if (startOffset < 0) break;
    candidates.push({ startOffset, endOffset: startOffset + exact.length });
    searchFrom = startOffset + Math.max(1, exact.length);
  }
  if (candidates.length === 1) return candidates[0] ?? null;

  const prefix = marker.prefix ?? "";
  const suffix = marker.suffix ?? "";
  if (!prefix && !suffix) return null;
  const contextual = candidates.filter(({ startOffset, endOffset }) => {
    const prefixMatches =
      !prefix ||
      messageText.slice(Math.max(0, startOffset - prefix.length), startOffset) === prefix;
    const suffixMatches =
      !suffix || messageText.slice(endOffset, endOffset + suffix.length) === suffix;
    return prefixMatches && suffixMatches;
  });
  return contextual.length === 1 ? (contextual[0] ?? null) : null;
}

export function isThreadMarkerAvailable(marker: ThreadMarker, messageText: string): boolean {
  return resolveThreadMarkerRange(marker, messageText) !== null;
}
