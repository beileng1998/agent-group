// FILE: codexVisualizationRemark.ts
// Purpose: Project standalone Codex visualization directives into custom Markdown elements.
// Layer: Web chat Markdown parsing

import { parseCodexInlineVisualizationDirective } from "@agent-group/shared/codexVisualizations";

export const CODEX_VISUALIZATION_TAG_NAME = "codex-inline-visualization";
export const CODEX_VISUALIZATION_FILE_ATTRIBUTE = "data-file-name";

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
}

function visualizationNode(fileName: string): MdastNode {
  return {
    type: "codexInlineVisualization",
    data: {
      hName: CODEX_VISUALIZATION_TAG_NAME,
      hProperties: { dataFileName: fileName },
    },
    children: [],
  };
}

function projectVisualizationDirectives(node: MdastNode): void {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    if (child.type === "paragraph" && child.children?.length === 1) {
      const onlyChild = child.children[0];
      if (onlyChild?.type === "text" && typeof onlyChild.value === "string") {
        const directive = parseCodexInlineVisualizationDirective(onlyChild.value);
        if (directive) return visualizationNode(directive.fileName);
      }
    }
    projectVisualizationDirectives(child);
    return child;
  });
}

export function createCodexVisualizationRemarkPlugin() {
  return () => (tree: unknown) => projectVisualizationDirectives(tree as MdastNode);
}
