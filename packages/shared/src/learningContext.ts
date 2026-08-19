// FILE: learningContext.ts
// Purpose: Defines the fixed Learning context template and its read-only projection.
// Layer: Shared runtime utility

import type { AgentGroupContextTemplate } from "@agent-group/contracts";

export const LEARNING_CONTEXT_TEMPLATE_ID = "learning";

export const LEARNING_CONTEXT_NOTE =
  "> Help the user understand the Goal. Preserve Knowledge. Keep Goal and State concise.";

const GOAL_GUIDE = "<!-- State what the user wants to understand and the intended depth. -->";

const KNOWLEDGE_GUIDE = [
  "<!--",
  "Grow H2 knowledge cards as the user's understanding develops.",
  "Each card explains one coherent idea with a meaningful title and a direct explanation.",
  "Use H3, examples, evidence, equations, or caveats only when useful.",
  "Revise, split, merge, or reorder cards whenever clarity improves.",
  "-->",
].join("\n");

const STATE_GUIDE =
  "<!-- Keep current understanding, open questions, and the next focus concise. -->";

export const LEARNING_CONTEXT_TEMPLATE_CONTENT = buildLearningContext({
  goal: GOAL_GUIDE,
  state: STATE_GUIDE,
});

export const LEARNING_CONTEXT_TEMPLATE: AgentGroupContextTemplate = {
  id: LEARNING_CONTEXT_TEMPLATE_ID,
  name: "Learning",
  description: "Goal, evolving knowledge cards, and learning state",
  content: LEARNING_CONTEXT_TEMPLATE_CONTENT,
};

export interface LearningContextCard {
  readonly key: string;
  readonly title: string;
  readonly markdown: string;
  readonly body: string;
  readonly ordinal: number;
}

export interface LearningContextProjection {
  readonly goal: string;
  readonly knowledgeLead: string;
  readonly cards: readonly LearningContextCard[];
  readonly state: string;
  readonly otherContext: string;
}

interface Heading {
  readonly level: number;
  readonly line: number;
  readonly title: string;
  readonly raw: string;
}

export function contextTemplatesWithLearning(
  templates: readonly AgentGroupContextTemplate[],
): readonly AgentGroupContextTemplate[] {
  return [
    LEARNING_CONTEXT_TEMPLATE,
    ...templates.filter((template) => template.id !== LEARNING_CONTEXT_TEMPLATE_ID),
  ];
}

export function resolveContextTemplateById(
  templates: readonly AgentGroupContextTemplate[],
  id: string | null,
): AgentGroupContextTemplate | undefined {
  if (id === LEARNING_CONTEXT_TEMPLATE_ID) return LEARNING_CONTEXT_TEMPLATE;
  return templates.find((template) => template.id === id);
}

export function buildPromotedLearningContext(input: { goal: string; sourceTitle: string }): string {
  const sourceTitle = input.sourceTitle.replace(/\s+/g, " ").trim() || "Knowledge card";
  return buildLearningContext({
    goal: input.goal,
    state: `Continue from the retained Side conversation. Source: "${sourceTitle}".`,
  });
}

export function parseLearningContext(markdown: string): LearningContextProjection | null {
  const lines = markdown.split(/\r?\n/);
  const headings = collectHeadings(lines);
  const knowledge = headings.find(
    (heading) => heading.level === 1 && heading.raw === "# Knowledge",
  );
  if (!knowledge) return null;

  const knowledgeEnd =
    headings.find((heading) => heading.level === 1 && heading.line > knowledge.line)?.line ??
    lines.length;
  const cardHeadings = headings.filter(
    (heading) =>
      heading.level === 2 && heading.line > knowledge.line && heading.line < knowledgeEnd,
  );
  const titleOccurrences = new Map<string, number>();
  const cards = cardHeadings.map((heading, index): LearningContextCard => {
    const end = cardHeadings[index + 1]?.line ?? knowledgeEnd;
    const identity = normalizeCardTitle(heading.title);
    const ordinal = (titleOccurrences.get(identity) ?? 0) + 1;
    titleOccurrences.set(identity, ordinal);
    return {
      key: `${identity}\n${ordinal}`,
      title: heading.title,
      markdown: lines.slice(heading.line, end).join("\n").trim(),
      body: lines
        .slice(heading.line + 1, end)
        .join("\n")
        .trim(),
      ordinal,
    };
  });
  const goal = findSectionBody(lines, headings, "# Goal");
  const state = findSectionBody(lines, headings, "# State");
  const excluded = new Set(
    headings
      .filter(
        (heading) =>
          heading.level === 1 &&
          (heading.raw === "# Goal" || heading.raw === "# Knowledge" || heading.raw === "# State"),
      )
      .map((heading) => heading.line),
  );

  return {
    goal,
    knowledgeLead: lines
      .slice(knowledge.line + 1, cardHeadings[0]?.line ?? knowledgeEnd)
      .join("\n")
      .trim(),
    cards,
    state,
    otherContext: collectOtherContext(lines, headings, excluded),
  };
}

function buildLearningContext(input: { goal: string; state: string }): string {
  return [
    LEARNING_CONTEXT_NOTE,
    "",
    "# Goal",
    "",
    input.goal,
    "",
    "# Knowledge",
    "",
    KNOWLEDGE_GUIDE,
    "",
    "# State",
    "",
    input.state,
    "",
  ].join("\n");
}

function collectHeadings(lines: readonly string[]): Heading[] {
  const headings: Heading[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;
  lines.forEach((line, index) => {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const token = fenceMatch[1]!;
      const marker = token[0] as "`" | "~";
      if (!fence) fence = { marker, length: token.length };
      else if (fence.marker === marker && token.length >= fence.length) fence = null;
      return;
    }
    if (fence) return;
    const match = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/);
    if (!match) return;
    const title = match[2]!.replace(/[ \t]+#+[ \t]*$/, "").trim();
    if (!title) return;
    headings.push({
      level: match[1]!.length,
      line: index,
      title,
      raw: line.trim(),
    });
  });
  return headings;
}

function findSectionBody(
  lines: readonly string[],
  headings: readonly Heading[],
  exact: string,
): string {
  const heading = headings.find((candidate) => candidate.level === 1 && candidate.raw === exact);
  if (!heading) return "";
  const end =
    headings.find((candidate) => candidate.level === 1 && candidate.line > heading.line)?.line ??
    lines.length;
  return lines
    .slice(heading.line + 1, end)
    .join("\n")
    .trim();
}

function collectOtherContext(
  lines: readonly string[],
  headings: readonly Heading[],
  excluded: ReadonlySet<number>,
): string {
  const ranges: string[] = [];
  headings
    .filter((heading) => heading.level === 1 && !excluded.has(heading.line))
    .forEach((heading) => {
      const end =
        headings.find((candidate) => candidate.level === 1 && candidate.line > heading.line)
          ?.line ?? lines.length;
      const section = lines.slice(heading.line, end).join("\n").trim();
      if (section) ranges.push(section);
    });
  return ranges.join("\n\n");
}

function normalizeCardTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
