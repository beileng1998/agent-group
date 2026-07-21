import type { HighlightListItem } from "@agent-group/contracts";

export const HIGHLIGHT_SYNTHESIS_MAX_ITEMS = 50;
export const HIGHLIGHT_SYNTHESIS_MAX_CHARS = 110_000;

export type HighlightSynthesisKind = "summary" | "note" | "outline" | "decisions";

export const HIGHLIGHT_SYNTHESIS_PROMPTS: Record<HighlightSynthesisKind, string> = {
  summary: "Summarize these highlights. Cite [H#] for key claims.",
  note: "Write a coherent Markdown note from these highlights. Cite [H#] for key claims.",
  outline: "Organize these highlights into a Markdown outline. Cite [H#] for key claims.",
  decisions: "Extract decisions, open questions, and action items. Cite [H#] for key claims.",
};

function quoteMarkdown(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function buildHighlightSynthesisMessage(
  instruction: string,
  items: readonly HighlightListItem[],
): string {
  if (items.length === 0) throw new Error("Select at least one highlight.");
  if (items.length > HIGHLIGHT_SYNTHESIS_MAX_ITEMS) {
    throw new Error(`Select no more than ${HIGHLIGHT_SYNTHESIS_MAX_ITEMS} highlights.`);
  }
  const prompt = instruction.trim();
  if (!prompt) throw new Error("Add an instruction for the synthesis session.");
  const sources = items.map((item, index) => {
    const heading = `### [H${index + 1}] ${item.group.title} › ${item.session.title}`;
    const sourceText = item.kind === "highlight" ? item.marker.selectedText : item.message.text;
    const annotation = item.kind === "highlight" ? item.marker.note : item.pin.label;
    const note = annotation ? `\n\nNote:\n${annotation}` : "";
    return `${heading}\n\n${quoteMarkdown(sourceText)}${note}`;
  });
  const message = `${prompt}\n\n## Selected highlights\n\n${sources.join("\n\n")}`;
  if (message.length > HIGHLIGHT_SYNTHESIS_MAX_CHARS) {
    throw new Error("The selected highlights are too large. Select fewer sources.");
  }
  return message;
}
