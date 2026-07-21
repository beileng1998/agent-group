// FILE: threadMarkerRemark.ts
// Purpose: Projects durable thread-marker ranges into Markdown text nodes.
// Layer: Chat Markdown parsing

import type { ThreadMarker } from "@agent-group/contracts";
import { resolveThreadMarkerRange } from "@agent-group/shared/threadMarkers";

type MarkdownTextNode = {
  type: "text";
  value: string;
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

type MarkdownParentNode = {
  type?: string;
  children?: MarkdownNode[];
};

type MarkdownNode = MarkdownTextNode | MarkdownParentNode | Record<string, unknown>;
type RenderableThreadMarker = ThreadMarker & { className: string };

function markerClassNameFor(marker: ThreadMarker) {
  return [
    "thread-marker",
    marker.style === "highlight" ? "thread-marker-highlight" : "thread-marker-underline",
    `thread-marker-${marker.color}`,
    marker.done ? "thread-marker-done" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function markerFragmentClassNameFor(
  marker: RenderableThreadMarker,
  continuity: { readonly continuesBefore: boolean; readonly continuesAfter: boolean },
): string {
  return [
    marker.className,
    continuity.continuesBefore ? "thread-marker-continues-before" : "",
    continuity.continuesAfter ? "thread-marker-continues-after" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizeRenderableMarkers(input: {
  text: string;
  markers: readonly ThreadMarker[] | undefined;
}): RenderableThreadMarker[] {
  const markers = input.markers ?? [];
  const result: RenderableThreadMarker[] = [];
  let previousEnd = -1;
  const resolved = markers.flatMap((marker) => {
    const range = resolveThreadMarkerRange(marker, input.text);
    return range ? [{ ...marker, ...range }] : [];
  });
  for (const marker of resolved.sort((left, right) => left.startOffset - right.startOffset)) {
    if (marker.startOffset < previousEnd) {
      continue;
    }
    result.push({
      ...marker,
      className: markerClassNameFor(marker),
    });
    previousEnd = marker.endOffset;
  }
  return result;
}

function applyThreadMarkersToNode(node: MarkdownNode, markers: readonly RenderableThreadMarker[]) {
  if (!node || typeof node !== "object" || !("children" in node) || !Array.isArray(node.children)) {
    return;
  }

  const parent = node as MarkdownParentNode;
  parent.children = (parent.children ?? []).flatMap((child) => {
    if (child && typeof child === "object" && "type" in child && child.type === "text") {
      return splitTextNodeWithMarkers(child as MarkdownTextNode, markers);
    }
    applyThreadMarkersToNode(child, markers);
    return [child];
  });
}

function splitTextNodeWithMarkers(
  node: MarkdownTextNode,
  markers: readonly RenderableThreadMarker[],
): MarkdownNode[] {
  const startOffset = node.position?.start?.offset;
  const endOffset = node.position?.end?.offset;
  if (startOffset === undefined || endOffset === undefined) {
    return [node];
  }
  const overlappingMarkers: RenderableThreadMarker[] = [];
  for (const marker of markers) {
    if (marker.endOffset <= startOffset) {
      continue;
    }
    if (marker.startOffset >= endOffset) {
      break;
    }
    overlappingMarkers.push(marker);
  }
  if (overlappingMarkers.length === 0) {
    return [node];
  }

  const nodes: MarkdownNode[] = [];
  let cursor = 0;
  for (const marker of overlappingMarkers) {
    const markerStart = Math.max(0, marker.startOffset - startOffset);
    const markerEnd = Math.min(node.value.length, marker.endOffset - startOffset);
    if (markerStart < cursor || markerEnd > node.value.length) {
      continue;
    }
    const absoluteFragmentStart = startOffset + markerStart;
    const absoluteFragmentEnd = startOffset + markerEnd;
    if (markerStart > cursor) {
      nodes.push({ type: "text", value: node.value.slice(cursor, markerStart) });
    }
    nodes.push({
      type: "threadMarker",
      data: {
        hName: "span",
        hProperties: {
          className: markerFragmentClassNameFor(marker, {
            continuesBefore: absoluteFragmentStart > marker.startOffset,
            continuesAfter: absoluteFragmentEnd < marker.endOffset,
          }),
          "data-thread-marker-id": marker.id,
          "data-thread-marker-style": marker.style,
          "data-thread-marker-color": marker.color,
        },
      },
      children: [{ type: "text", value: node.value.slice(markerStart, markerEnd) }],
    });
    cursor = markerEnd;
  }
  if (cursor < node.value.length) {
    nodes.push({ type: "text", value: node.value.slice(cursor) });
  }
  return nodes.length > 0 ? nodes : [node];
}

export function createThreadMarkerRemarkPlugin(input: {
  text: string;
  markers: readonly ThreadMarker[] | undefined;
}) {
  const markers = normalizeRenderableMarkers(input);
  return () => (tree: MarkdownNode) => {
    if (markers.length > 0) {
      applyThreadMarkersToNode(tree, markers);
    }
  };
}
