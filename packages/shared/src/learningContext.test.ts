import { describe, expect, it } from "vitest";

import {
  LEARNING_CONTEXT_NOTE,
  LEARNING_CONTEXT_TEMPLATE_CONTENT,
  buildPromotedLearningContext,
  parseLearningContext,
} from "./learningContext";

describe("Learning context", () => {
  it("keeps the fixed template self-contained and lightweight", () => {
    expect(LEARNING_CONTEXT_TEMPLATE_CONTENT).toContain(LEARNING_CONTEXT_NOTE);
    expect(LEARNING_CONTEXT_TEMPLATE_CONTENT).toContain(
      "Grow H2 knowledge cards as the user's understanding develops.",
    );
    expect(LEARNING_CONTEXT_TEMPLATE_CONTENT).toMatch(
      /# Goal[\s\S]*# Knowledge[\s\S]*# State/,
    );
    expect(LEARNING_CONTEXT_TEMPLATE_CONTENT).not.toContain("100 lines");
  });

  it("projects H2 cards only inside the exact Knowledge H1", () => {
    const projection = parseLearningContext(
      [
        "# Goal",
        "Understand XOR.",
        "",
        "# Knowledge",
        "A short map.",
        "",
        "## Exclusive choice",
        "XOR is true when inputs differ.",
        "",
        "### Example",
        "`true XOR false` is true.",
        "",
        "```md",
        "## Not a card",
        "```",
        "",
        "## Exclusive choice",
        "A second card may reuse a title.",
        "",
        "# State",
        "Compare XOR with OR.",
        "",
        "# References",
        "- A durable source",
      ].join("\n"),
    );

    expect(projection?.goal).toBe("Understand XOR.");
    expect(projection?.knowledgeLead).toBe("A short map.");
    expect(projection?.cards).toHaveLength(2);
    expect(projection?.cards[0]).toMatchObject({
      title: "Exclusive choice",
      ordinal: 1,
      key: "exclusive choice\n1",
    });
    expect(projection?.cards[0]?.body).toContain("## Not a card");
    expect(projection?.cards[1]).toMatchObject({
      ordinal: 2,
      key: "exclusive choice\n2",
    });
    expect(projection?.state).toBe("Compare XOR with OR.");
    expect(projection?.otherContext).toBe("# References\n- A durable source");
  });

  it("falls back for a non-exact Knowledge marker", () => {
    expect(parseLearningContext("# Goal\nLearn\n\n# knowledge\n\n## Card\nBody\n")).toBeNull();
    expect(parseLearningContext("# Goal\nLearn\n\n## Knowledge\n\n## Card\nBody\n")).toBeNull();
    expect(parseLearningContext("# Goal\nLearn\n\n# Knowledge #\n\n## Card\nBody\n")).toBeNull();
  });

  it("preserves the first Side question in a promoted Learning Goal", () => {
    const question = "Why does this remain true?\n\nPlease use a counterexample.";
    const context = buildPromotedLearningContext({
      goal: question,
      sourceTitle: "  XOR   intuition  ",
    });

    expect(context).toContain(`# Goal\n\n${question}\n\n# Knowledge`);
    expect(context).toContain('Source: "XOR intuition".');
    expect(parseLearningContext(context)?.goal).toBe(question);
  });
});
