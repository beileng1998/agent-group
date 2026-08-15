import type { LegendListRef } from "@legendapp/list/react";

export type TranscriptScrollTarget = Pick<LegendListRef, "scrollToEnd">;
export type TranscriptScrollCancellationTarget = Pick<
  LegendListRef,
  "getScrollableNode" | "scrollToOffset"
>;

/** Stop an in-flight native smooth scroll without changing the visible offset. */
export function stopTranscriptScrollAtCurrentOffset(
  target: TranscriptScrollCancellationTarget,
): Promise<void> {
  const scrollNode = target.getScrollableNode();
  const offset = scrollNode.scrollTop;
  scrollNode.scrollTo({ top: offset, behavior: "auto" });
  return target.scrollToOffset({ offset, animated: false });
}

/** Smoothly reach the tail, then settle once more after virtual rows are measured. */
export async function scrollTranscriptToSettledEnd(input: {
  readonly target: TranscriptScrollTarget;
  readonly isCurrent: () => boolean;
  readonly beforeFinalScroll?: () => void;
}): Promise<boolean> {
  await input.target.scrollToEnd({ animated: true });
  if (!input.isCurrent()) return false;

  input.beforeFinalScroll?.();
  await input.target.scrollToEnd({ animated: false });
  return input.isCurrent();
}
