import { describe, expect, it } from "vitest";

import {
  CONTEXT_COMPACTION_NOTE,
  CONTEXT_TEMPLATE_PRESETS,
  DEFAULT_CONTEXT_TEMPLATE,
} from "./contextTemplates";

describe("Agent Group context templates", () => {
  it("matches the current standard context template", () => {
    expect(DEFAULT_CONTEXT_TEMPLATE).toBe(
      [
        CONTEXT_COMPACTION_NOTE,
        "",
        "# Goal",
        "<!-- State this session's objective, scope, and completion criteria. -->",
        "",
        "# State",
        "<!-- Record progress, completed work, and durable facts. -->",
        "",
        "# ADR",
        "<!-- Record important decisions, reasoning, and tradeoffs. -->",
        "",
        "# Next",
        "<!-- State the most valuable next step. -->",
        "",
      ].join("\n"),
    );
  });

  it("offers the four current presets", () => {
    expect(CONTEXT_TEMPLATE_PRESETS.map((preset) => preset.id)).toEqual([
      "standard",
      "minimal",
      "delivery",
      "research",
    ]);
    expect(
      CONTEXT_TEMPLATE_PRESETS.every((preset) =>
        preset.content.startsWith(CONTEXT_COMPACTION_NOTE),
      ),
    ).toBe(true);
  });
});
