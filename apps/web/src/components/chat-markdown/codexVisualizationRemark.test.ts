import { describe, expect, it } from "vitest";

import {
  CODEX_VISUALIZATION_FILE_ATTRIBUTE,
  CODEX_VISUALIZATION_TAG_NAME,
  createCodexVisualizationRemarkPlugin,
} from "./codexVisualizationRemark";

describe("Codex visualization remark projection", () => {
  it("replaces only a standalone directive paragraph", () => {
    const tree = {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", value: "Before" }] },
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              value: '::codex-inline-vis{file="status-map.html"}',
            },
          ],
        },
      ],
    };
    createCodexVisualizationRemarkPlugin()()(tree);
    expect(tree.children[1]).toMatchObject({
      type: "codexInlineVisualization",
      data: {
        hName: CODEX_VISUALIZATION_TAG_NAME,
        hProperties: { dataFileName: "status-map.html" },
      },
    });
    expect(CODEX_VISUALIZATION_FILE_ATTRIBUTE).toBe("data-file-name");
  });

  it("leaves inline text and invalid paths literal", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              value: 'See ::codex-inline-vis{file="status-map.html"}',
            },
          ],
        },
        {
          type: "paragraph",
          children: [{ type: "text", value: '::codex-inline-vis{file="../x.html"}' }],
        },
      ],
    };
    createCodexVisualizationRemarkPlugin()()(tree);
    expect(tree.children.every((child) => child.type === "paragraph")).toBe(true);
  });
});
