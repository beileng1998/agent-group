/**
 * Shared plan-mode helpers for provider adapters.
 *
 * Adapters use this prompt shim when their native plan mode does not emit a
 * first-class proposed-plan event. The extraction helpers keep the UI path
 * provider-agnostic by converting tagged markdown into canonical runtime events.
 */

export const NATIVE_PLAN_MODE_PROMPT =
  "Plan mode. Do not edit files. Make reasonable assumptions and return an implementation plan.";

export const PROVIDER_PLAN_MODE_PROMPT_PREFIX =
  "Plan mode. Do not edit files. Return the final plan inside <proposed_plan>...</proposed_plan>.";

const PROPOSED_PLAN_BLOCK_REGEX = /<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/i;

export function withProviderPlanModePrompt(input: {
  readonly text: string;
  readonly interactionMode?: "default" | "plan" | undefined;
}): string {
  if (input.interactionMode !== "plan") {
    return input.text;
  }
  const text = input.text.trim();
  return text.length > 0
    ? `${PROVIDER_PLAN_MODE_PROMPT_PREFIX}\n\nUser request:\n${text}`
    : PROVIDER_PLAN_MODE_PROMPT_PREFIX;
}

export function extractProposedPlanMarkdown(text: string | undefined): string | undefined {
  const match = text ? PROPOSED_PLAN_BLOCK_REGEX.exec(text) : null;
  const planMarkdown = match?.[1]?.trim();
  return planMarkdown && planMarkdown.length > 0 ? planMarkdown : undefined;
}
