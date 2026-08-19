import { describe, expect, it } from "vitest";

import {
  scrollTranscriptToSettledEnd,
  stopTranscriptScrollAtCurrentOffset,
  type TranscriptScrollCancellationTarget,
  type TranscriptScrollTarget,
} from "./transcriptScroll";

describe("transcript scroll helpers", () => {
  it("interrupts native and virtual-list smooth scrolling at the current offset", async () => {
    const nativeCalls: ScrollToOptions[] = [];
    const offsetCalls: Array<{ offset: number; animated?: boolean }> = [];
    const scrollNode = {
      scrollTop: 420,
      scrollTo: (options: ScrollToOptions) => nativeCalls.push(options),
    } as unknown as HTMLElement;
    const target: TranscriptScrollCancellationTarget = {
      getScrollableNode: () => scrollNode,
      scrollToOffset: async (options) => {
        offsetCalls.push({
          offset: options.offset,
          ...(options.animated === undefined ? {} : { animated: options.animated }),
        });
      },
    };

    await stopTranscriptScrollAtCurrentOffset(target);

    expect(nativeCalls).toEqual([{ top: 420, behavior: "auto" }]);
    expect(offsetCalls).toEqual([{ offset: 420, animated: false }]);
  });

  it("finishes a smooth jump with an exact tail settle", async () => {
    const animations: boolean[] = [];
    const target: TranscriptScrollTarget = {
      scrollToEnd: async ({ animated = true } = {}) => void animations.push(animated),
    };

    await expect(scrollTranscriptToSettledEnd({ target, isCurrent: () => true })).resolves.toBe(
      true,
    );
    expect(animations).toEqual([true, false]);
  });

  it("does not settle after user takeover", async () => {
    let finishSmoothScroll: (() => void) | null = null;
    let current = true;
    const animations: boolean[] = [];
    const target: TranscriptScrollTarget = {
      scrollToEnd: ({ animated = true } = {}) => {
        animations.push(animated);
        return new Promise<void>((resolve) => {
          finishSmoothScroll = resolve;
        });
      },
    };

    const result = scrollTranscriptToSettledEnd({ target, isCurrent: () => current });
    current = false;
    (finishSmoothScroll as unknown as () => void)();

    await expect(result).resolves.toBe(false);
    expect(animations).toEqual([true]);
  });
});
