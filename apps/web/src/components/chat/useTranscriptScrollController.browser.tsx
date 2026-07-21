// FILE: useTranscriptScrollController.browser.tsx
// Purpose: Browser regression for send-time transcript tail stabilization.
// Layer: Vitest browser tests

import { MessageId, ThreadId } from "@agent-group/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import { useLayoutEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import type { TimelineEntry } from "../../session-logic";
import {
  TRANSCRIPT_AUTO_FOLLOW_SETTLE_DELAY_MS,
  useTranscriptScrollController,
} from "./useTranscriptScrollController";

const THREAD_ID = ThreadId.makeUnsafe("transcript-scroll-controller-test");

interface ScrollCall {
  animated: boolean;
  at: number;
}

function userEntry(): TimelineEntry {
  return {
    id: "entry-user-send",
    kind: "message",
    createdAt: "2026-07-21T12:00:00.000Z",
    message: {
      id: MessageId.makeUnsafe("message-user-send"),
      role: "user",
      text: "Follow up",
      createdAt: "2026-07-21T12:00:00.000Z",
      streaming: false,
    },
  };
}

function ScrollControllerHarness({ calls }: { calls: ScrollCall[] }) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const scroll = useTranscriptScrollController({
    threadId: THREAD_ID,
    activeThreadId: THREAD_ID,
    composerStackedChromeHeight: 0,
    timelineEntries: entries,
  });

  useLayoutEffect(() => {
    scroll.legendListRef.current = {
      scrollToEnd: ({ animated = true } = {}) => {
        calls.push({ animated, at: performance.now() });
      },
    } as LegendListRef;
    return () => {
      scroll.legendListRef.current = null;
    };
  }, [calls, scroll.legendListRef]);

  return (
    <button
      type="button"
      onWheel={scroll.onMessagesWheelBase}
      onClick={() => {
        scroll.armTranscriptAutoFollow(THREAD_ID, true);
        setEntries([userEntry()]);
      }}
    >
      Send follow-up
    </button>
  );
}

describe("useTranscriptScrollController", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("re-sticks after the previous turn's settled layout finishes closing", async () => {
    const calls: ScrollCall[] = [];
    const screen = await render(<ScrollControllerHarness calls={calls} />);

    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      calls.length = 0;
      const startedAt = performance.now();
      document.querySelector<HTMLButtonElement>("button")?.click();

      await expect.poll(() => calls.some((call) => call.animated)).toBe(true);
      await expect
        .poll(() =>
          calls.some(
            (call) =>
              !call.animated &&
              call.at - startedAt >= TRANSCRIPT_AUTO_FOLLOW_SETTLE_DELAY_MS - 24,
          ),
        )
        .toBe(true);
    } finally {
      await screen.unmount();
    }
  });

  it("does not re-stick after the user interrupts send-time auto-follow", async () => {
    const calls: ScrollCall[] = [];
    const screen = await render(<ScrollControllerHarness calls={calls} />);

    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      calls.length = 0;
      const button = document.querySelector<HTMLButtonElement>("button");
      button?.click();

      await expect.poll(() => calls.some((call) => call.animated)).toBe(true);
      button?.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      await new Promise<void>((resolve) =>
        window.setTimeout(resolve, TRANSCRIPT_AUTO_FOLLOW_SETTLE_DELAY_MS + 48),
      );

      expect(calls.filter((call) => !call.animated)).toHaveLength(0);
    } finally {
      await screen.unmount();
    }
  });
});
