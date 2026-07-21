// FILE: contextTemplates.ts
// Purpose: Shared Agent Group context.md presets used by runtime defaults and settings UI.
// Layer: Shared runtime utility

export const CONTEXT_COMPACTION_NOTE =
  "> Keep this file concise. If it exceeds 100 lines, compress it by removing stale or low-value information first.";

const standard = [
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
].join("\n");

const minimal = [
  CONTEXT_COMPACTION_NOTE,
  "",
  "# Focus",
  "<!-- State the current objective. -->",
  "",
  "# State",
  "<!-- Keep only durable progress and blockers. -->",
  "",
  "# Next",
  "<!-- State the single best next step. -->",
  "",
].join("\n");

const delivery = [
  CONTEXT_COMPACTION_NOTE,
  "",
  "# Outcome",
  "<!-- Define the result this session must deliver. -->",
  "",
  "# Constraints",
  "<!-- Record only constraints that affect execution. -->",
  "",
  "# Progress",
  "<!-- Record completed work and current blockers. -->",
  "",
  "# Decisions",
  "<!-- Record decisions that future work must preserve. -->",
  "",
  "# Next",
  "<!-- State the next concrete action. -->",
  "",
].join("\n");

const research = [
  CONTEXT_COMPACTION_NOTE,
  "",
  "# Question",
  "<!-- State the question being investigated. -->",
  "",
  "# Evidence",
  "<!-- Record durable sources, observations, and constraints. -->",
  "",
  "# Findings",
  "<!-- Record supported conclusions. -->",
  "",
  "# Open Questions",
  "<!-- Keep only unresolved questions that still matter. -->",
  "",
  "# Next",
  "<!-- State the next useful investigation. -->",
  "",
].join("\n");

export const CONTEXT_TEMPLATE_PRESETS = [
  {
    id: "standard",
    name: "Standard",
    description: "Goal, state, decisions, and next step",
    content: standard,
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Only the current focus, state, and next step",
    content: minimal,
  },
  {
    id: "delivery",
    name: "Delivery",
    description: "Outcome, constraints, progress, and decisions",
    content: delivery,
  },
  {
    id: "research",
    name: "Research",
    description: "Questions, evidence, findings, and open issues",
    content: research,
  },
] as const;

export const DEFAULT_CONTEXT_TEMPLATE = standard;
