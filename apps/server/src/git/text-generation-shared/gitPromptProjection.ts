import { Schema } from "effect";
import type { ChatAttachment } from "@agent-group/contracts";

import type { RawTextFallback } from "./outputParsing.ts";
import { attachmentMetadataLines, limitSection } from "./promptInputs.ts";

export function buildCommitMessagePrompt(input: {
  readonly branch: string | null;
  readonly stagedSummary: string;
  readonly stagedPatch: string;
  readonly includeBranch: boolean;
}) {
  const prompt = [
    "You write concise git commit messages.",
    input.includeBranch
      ? "Return a JSON object with keys: subject, body, branch."
      : "Return a JSON object with keys: subject, body.",
    "Respond with only the JSON object, no prose and no code fences.",
    "Rules:",
    "- subject must be imperative, <= 72 chars, and no trailing period",
    "- body can be empty string or short bullet points",
    ...(input.includeBranch
      ? ["- branch must be a short semantic git branch fragment for this change"]
      : []),
    "- capture the primary user-visible or developer-visible change",
    "",
    `Branch: ${input.branch ?? "(detached)"}`,
    "",
    "Staged files:",
    limitSection(input.stagedSummary, 6_000),
    "",
    "Staged patch:",
    limitSection(input.stagedPatch, 40_000),
  ].join("\n");

  const outputSchemaJson = input.includeBranch
    ? Schema.Struct({
        subject: Schema.String,
        body: Schema.String,
        branch: Schema.String,
      })
    : Schema.Struct({
        subject: Schema.String,
        body: Schema.String,
      });

  return { prompt, outputSchemaJson };
}

export function buildPrContentPrompt(input: {
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly commitSummary: string;
  readonly diffSummary: string;
  readonly diffPatch: string;
}) {
  return {
    prompt: [
      "You write GitHub pull request content.",
      "Return a JSON object with keys: title, body.",
      "Respond with only the JSON object, no prose and no code fences.",
      "Rules:",
      "- title should be concise and specific",
      "- body must be markdown and include headings '## Summary' and '## Testing'",
      "- under Summary, provide short bullet points",
      "- under Testing, include bullet points with concrete checks or 'Not run' where appropriate",
      "",
      `Base branch: ${input.baseBranch}`,
      `Head branch: ${input.headBranch}`,
      "",
      "Commits:",
      limitSection(input.commitSummary, 12_000),
      "",
      "Diff stat:",
      limitSection(input.diffSummary, 12_000),
      "",
      "Diff patch:",
      limitSection(input.diffPatch, 40_000),
    ].join("\n"),
    outputSchemaJson: Schema.Struct({
      title: Schema.String,
      body: Schema.String,
    }),
  };
}

export function buildDiffSummaryPrompt(input: { readonly patch: string }) {
  return {
    prompt: [
      "You write GitHub-style engineering summaries for git diffs.",
      "Return a JSON object with key: summary.",
      "Respond with only the JSON object, no prose and no code fences.",
      "Rules:",
      "- summary must be markdown",
      "- include headings '## Summary' and '## Files Changed'",
      "- under each heading, use concise bullet points",
      "- describe only changes directly supported by the diff",
      "- mention risks or follow-ups only when clearly implied by the patch",
      "- do not invent tests, tickets, or product context",
      "",
      "Diff patch:",
      limitSection(input.patch, 50_000),
    ].join("\n"),
    outputSchemaJson: Schema.Struct({
      summary: Schema.String,
    }),
    rawTextFallback: { key: "summary" } satisfies RawTextFallback,
  };
}

export function buildBranchNamePrompt(input: {
  readonly message: string;
  readonly attachments?: ReadonlyArray<ChatAttachment>;
}) {
  const attachmentLines = attachmentMetadataLines(input.attachments);
  const promptSections = [
    "You generate concise git branch names.",
    "Return a JSON object with key: branch.",
    "Respond with only the JSON object, no prose and no code fences.",
    "Rules:",
    "- Branch should describe the requested work from the user message.",
    "- Keep it short and specific (2-6 words).",
    "- Use plain words only, no issue prefixes and no punctuation-heavy text.",
    "- If images are attached, use them as primary context for visual/UI issues.",
    "",
    "User message:",
    limitSection(input.message, 8_000),
  ];
  if (attachmentLines.length > 0) {
    promptSections.push(
      "",
      "Attachment metadata:",
      limitSection(attachmentLines.join("\n"), 4_000),
    );
  }

  return {
    prompt: promptSections.join("\n"),
    outputSchemaJson: Schema.Struct({
      branch: Schema.String,
    }),
    rawTextFallback: { key: "branch", maxWords: 8 } satisfies RawTextFallback,
  };
}
