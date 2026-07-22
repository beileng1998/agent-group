import { describe, expect, it } from "vitest";

import {
  extractCodexInlineVisualizationDirectives,
  isCodexVisualizationFileName,
  parseCodexInlineVisualizationDirective,
} from "./codexVisualizations";

describe("Codex visualization compatibility contract", () => {
  it("accepts only the strict standalone directive", () => {
    expect(
      parseCodexInlineVisualizationDirective(
        '::codex-inline-vis{file="awareness-state-options.html"}',
      ),
    ).toEqual({ fileName: "awareness-state-options.html" });
    expect(
      parseCodexInlineVisualizationDirective('prefix ::codex-inline-vis{file="x.html"}'),
    ).toBeNull();
    expect(
      parseCodexInlineVisualizationDirective('::codex-inline-vis{file="../x.html"}'),
    ).toBeNull();
  });

  it("deduplicates directives while preserving message order", () => {
    expect(
      extractCodexInlineVisualizationDirectives(
        'Before\n::codex-inline-vis{file="one.html"}\n::codex-inline-vis{file="one.html"}\n::codex-inline-vis{file="two.html"}',
      ),
    ).toEqual([{ fileName: "one.html" }, { fileName: "two.html" }]);
  });

  it("rejects paths and unsupported file names", () => {
    expect(isCodexVisualizationFileName("state-options.html")).toBe(true);
    expect(isCodexVisualizationFileName("State Options.html")).toBe(false);
    expect(isCodexVisualizationFileName("state-options.svg")).toBe(false);
  });

  it("bounds the number of artifacts captured from one message", () => {
    const text = Array.from(
      { length: 12 },
      (_, index) => `::codex-inline-vis{file="visual-${index}.html"}`,
    ).join("\n");
    expect(extractCodexInlineVisualizationDirectives(text)).toHaveLength(8);
  });
});
