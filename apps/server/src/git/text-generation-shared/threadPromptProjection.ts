import { Schema } from "effect";
import type { ChatAttachment } from "@agent-group/contracts";
import { MAX_CHAT_THREAD_TITLE_WORDS } from "@agent-group/shared/chatThreads";

import type { RawTextFallback } from "./outputParsing.ts";
import { attachmentMetadataLines, limitSection } from "./promptInputs.ts";

export function buildThreadRecapPrompt(input: {
  readonly previousRecap?: string;
  readonly newMaterial: string;
  readonly currentState?: string;
}) {
  return {
    prompt: [
      "You are writing a compact live recap for Agent Group's chat side panel.",
      "Return a JSON object with key: recap.",
      "Respond with only the JSON object, no prose and no code fences.",
      "Goal:",
      "Help the user quickly remember what happened in this chat, especially the latest concrete work and the current next step.",
      "",
      "Rules:",
      "- recap must be only the recap text; no title, no prefix, no bullets, no markdown",
      "- use the same language as the active chat",
      "- maximum 220 characters; prefer 150-190 characters",
      "- write one compact paragraph that fits in 3-4 narrow panel lines",
      "- mention the current work area first",
      "- prioritize recent completed changes over old context",
      "- include the next step, blocker, or pending decision if useful",
      "- ignore tool noise unless it changed the outcome",
      "- do not invent completed work, files, tests, or decisions",
      "- if there is no meaningful new information, return the previous recap unchanged",
      "",
      "Previous recap:",
      limitSection(input.previousRecap?.trim() || "(none)", 600),
      "",
      "New material:",
      limitSection(input.newMaterial, 5_000),
      "",
      "Current state:",
      limitSection(input.currentState?.trim() || "(none)", 1_500),
    ].join("\n"),
    outputSchemaJson: Schema.Struct({
      recap: Schema.String,
    }),
    rawTextFallback: { key: "recap" } satisfies RawTextFallback,
  };
}

export function buildThreadTitlePrompt(input: {
  readonly message: string;
  readonly attachments?: ReadonlyArray<ChatAttachment>;
}) {
  const attachmentLines = attachmentMetadataLines(input.attachments);
  const promptSections = [
    "You generate concise chat thread titles.",
    "Return a JSON object with key: title.",
    "Respond with only the JSON object, no prose and no code fences.",
    "Rules:",
    `- Summarize the user's request in 3-${MAX_CHAT_THREAD_TITLE_WORDS} words.`,
    `- Never exceed ${MAX_CHAT_THREAD_TITLE_WORDS} words.`,
    "- Be specific: include distinguishing identifiers from the message when present (PR/issue numbers, branch names, file or feature names, error codes).",
    "- Two different requests should never produce the same title if the message contains anything that tells them apart.",
    "- Use a short noun or verb phrase, not a full sentence.",
    "- Avoid quotes, markdown, emoji, and trailing punctuation.",
    "- If images are attached, use them as primary context for the title.",
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
      title: Schema.String,
    }),
    // Looser than the final cap: raw (non-JSON) output is only rejected as "not a
    // title" past this size; sanitizeGeneratedThreadTitle still trims to the cap.
    rawTextFallback: {
      key: "title",
      maxWords: MAX_CHAT_THREAD_TITLE_WORDS + 4,
    } satisfies RawTextFallback,
  };
}
