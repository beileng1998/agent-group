// FILE: transcriptSourceMapRemark.ts
// Purpose: Preserve raw Markdown offsets on rendered assistant text for exact multi-line selections.

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

function wrapTextChildren(node: MarkdownNode) {
  if (!node || typeof node !== "object" || !("children" in node) || !Array.isArray(node.children)) {
    return;
  }

  const parent = node as MarkdownParentNode;
  parent.children = (parent.children ?? []).map((child) => {
    if (child && typeof child === "object" && "type" in child && child.type === "text") {
      const text = child as MarkdownTextNode;
      const startOffset = text.position?.start?.offset;
      const endOffset = text.position?.end?.offset;
      if (startOffset === undefined || endOffset === undefined || endOffset <= startOffset) {
        return child;
      }
      return {
        type: "transcriptSource",
        data: {
          hName: "span",
          hProperties: {
            "data-transcript-source-start": startOffset,
            "data-transcript-source-end": endOffset,
          },
        },
        children: [child],
      };
    }
    wrapTextChildren(child);
    return child;
  });
}

export function createTranscriptSourceMapRemarkPlugin() {
  return () => (tree: MarkdownNode) => wrapTextChildren(tree);
}
