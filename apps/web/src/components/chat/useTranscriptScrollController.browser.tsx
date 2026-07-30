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

function assistantEntry(streaming: boolean): TimelineEntry {
  return {
    id: "entry-assistant-result",
    kind: "message",
    createdAt: "2026-07-21T12:00:01.000Z",
    message: {
      id: MessageId.makeUnsafe("message-assistant-result"),
      role: "assistant",
      text: streaming ? "Finishing the result" : "Final result",
      createdAt: "2026-07-21T12:00:01.000Z",
      streaming,
      ...(streaming ? {} : { completedAt: "2026-07-21T12:00:02.000Z" }),
    },
  };
}

function ScrollControllerHarness({ calls }: { calls: ScrollCall[] }) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const scroll = useTranscriptScrollController({
    threadId: THREAD_ID,
    activeThreadId: THREAD_ID,
    activeTurnInProgress: entries.length > 0,
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
    <div onWheel={scroll.onMessagesWheelBase}>
      <button
        type="button"
        onClick={() => {
          scroll.armTranscriptAutoFollow(THREAD_ID, true);
          setEntries([userEntry()]);
        }}
      >
        Send follow-up
      </button>
    </div>
  );
}

function SettlementProbe({
  settled,
  onIsAtEndChange,
}: {
  settled: boolean;
  onIsAtEndChange: (isAtEnd: boolean) => void;
}) {
  useLayoutEffect(() => {
    if (settled) onIsAtEndChange(false);
  }, [onIsAtEndChange, settled]);
  return null;
}

function TurnSettlementHarness({ calls }: { calls: ScrollCall[] }) {
  const [activeTurnInProgress, setActiveTurnInProgress] = useState(true);
  const [entries, setEntries] = useState<TimelineEntry[]>(() => [assistantEntry(true)]);
  const scroll = useTranscriptScrollController({
    threadId: THREAD_ID,
    activeThreadId: THREAD_ID,
    activeTurnInProgress,
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
    <div onWheel={scroll.onMessagesWheelBase}>
      <SettlementProbe
        settled={!activeTurnInProgress}
        onIsAtEndChange={scroll.onIsAtEndChange}
      />
      <button
        type="button"
        onClick={() => {
          setEntries([assistantEntry(false)]);
          setActiveTurnInProgress(false);
        }}
      >
        Settle turn
      </button>
    </div>
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
              !call.animated && call.at - startedAt >= TRANSCRIPT_AUTO_FOLLOW_SETTLE_DELAY_MS - 24,
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

  it("keeps the latest result visible when the active turn settles and folds", async () => {
    const calls: ScrollCall[] = [];
    const screen = await render(<TurnSettlementHarness calls={calls} />);

    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      calls.length = 0;
      const startedAt = performance.now();
      document.querySelector<HTMLButtonElement>("button")?.click();

      await expect.poll(() => calls.length > 0).toBe(true);
      await expect
        .poll(() =>
          calls.some(
            (call) =>
              !call.animated && call.at - startedAt >= TRANSCRIPT_AUTO_FOLLOW_SETTLE_DELAY_MS - 24,
          ),
        )
        .toBe(true);
    } finally {
      await screen.unmount();
    }
  });

  it("does not force the latest result after the user leaves the live tail", async () => {
    const calls: ScrollCall[] = [];
    const screen = await render(<TurnSettlementHarness calls={calls} />);

    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      calls.length = 0;
      const button = document.querySelector<HTMLButtonElement>("button");
      button?.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      button?.click();
      await new Promise<void>((resolve) =>
        window.setTimeout(resolve, TRANSCRIPT_AUTO_FOLLOW_SETTLE_DELAY_MS + 48),
      );

      expect(calls).toHaveLength(0);
    } finally {
      await screen.unmount();
    }
  });

  it("cancels the completion re-stick when the user scrolls after settlement", async () => {
    const calls: ScrollCall[] = [];
    const screen = await render(<TurnSettlementHarness calls={calls} />);

    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      calls.length = 0;
      const button = document.querySelector<HTMLButtonElement>("button");
      button?.click();
      await expect.poll(() => calls.length > 0).toBe(true);
      calls.length = 0;
      button?.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      await new Promise<void>((resolve) =>
        window.setTimeout(resolve, TRANSCRIPT_AUTO_FOLLOW_SETTLE_DELAY_MS + 48),
      );

      expect(calls).toHaveLength(0);
    } finally {
      await screen.unmount();
    }
  });
});
