// FILE: MessagesTimeline.collapse.browser.tsx
// Purpose: Browser regression for settled process-message disclosure behavior.
// Layer: Vitest browser tests

import "../../index.css";

import { MessageId, ThreadId, TurnId } from "@agent-group/contracts";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import type { TimelineEntry } from "../../session-logic";
import { MessagesTimeline } from "./MessagesTimeline";
import {
  TRANSCRIPT_AUTO_FOLLOW_SETTLE_DELAY_MS,
  useTranscriptScrollController,
} from "./useTranscriptScrollController";

const COMPLETION_THREAD_ID = ThreadId.makeUnsafe("completion-scroll-thread");
const COMPLETION_TURN_ID = TurnId.makeUnsafe("completion-scroll-turn");

function SettledTimeline() {
  return (
    <div style={{ height: 420 }}>
      <MessagesTimeline
        hasMessages
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        timelineEntries={[
          {
            id: "entry-user",
            kind: "message",
            createdAt: "2026-07-28T10:00:00.000Z",
            message: {
              id: MessageId.makeUnsafe("message-user"),
              role: "user",
              text: "Fix it",
              turnId: TurnId.makeUnsafe("turn-1"),
              createdAt: "2026-07-28T10:00:00.000Z",
              streaming: false,
            },
          },
          {
            id: "entry-process",
            kind: "message",
            createdAt: "2026-07-28T10:00:01.000Z",
            message: {
              id: MessageId.makeUnsafe("message-process"),
              role: "assistant",
              text: "Checking the implementation now.",
              turnId: TurnId.makeUnsafe("turn-1"),
              createdAt: "2026-07-28T10:00:01.000Z",
              completedAt: "2026-07-28T10:00:02.000Z",
              streaming: false,
            },
          },
          {
            id: "entry-work",
            kind: "work",
            createdAt: "2026-07-28T10:00:03.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-07-28T10:00:03.000Z",
              label: "Read files",
              tone: "tool",
            },
          },
          {
            id: "entry-final",
            kind: "message",
            createdAt: "2026-07-28T10:00:04.000Z",
            message: {
              id: MessageId.makeUnsafe("message-final"),
              role: "assistant",
              text: "Fixed.",
              turnId: TurnId.makeUnsafe("turn-1"),
              createdAt: "2026-07-28T10:00:04.000Z",
              completedAt: "2026-07-28T10:00:05.000Z",
              streaming: false,
            },
          },
        ]}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-07-28T10:00:05.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />
    </div>
  );
}

function completionTimelineEntries(settled: boolean): TimelineEntry[] {
  const previousTurns = Array.from({ length: 7 }, (_, index) => {
    const minute = String(index).padStart(2, "0");
    return [
      {
        id: `previous-user-entry-${index}`,
        kind: "message" as const,
        createdAt: `2026-07-28T09:${minute}:00.000Z`,
        message: {
          id: MessageId.makeUnsafe(`previous-user-${index}`),
          role: "user" as const,
          text: `Previous question ${index}`,
          createdAt: `2026-07-28T09:${minute}:00.000Z`,
          streaming: false,
        },
      },
      {
        id: `previous-assistant-entry-${index}`,
        kind: "message" as const,
        createdAt: `2026-07-28T09:${minute}:01.000Z`,
        message: {
          id: MessageId.makeUnsafe(`previous-assistant-${index}`),
          role: "assistant" as const,
          text: `Previous result ${index}`,
          createdAt: `2026-07-28T09:${minute}:01.000Z`,
          completedAt: `2026-07-28T09:${minute}:02.000Z`,
          streaming: false,
        },
      },
    ];
  }).flat();

  return [
    ...previousTurns,
    {
      id: "completion-user-entry",
      kind: "message",
      createdAt: "2026-07-28T10:00:00.000Z",
      message: {
        id: MessageId.makeUnsafe("completion-user"),
        role: "user",
        text: "Finish the current turn",
        turnId: COMPLETION_TURN_ID,
        createdAt: "2026-07-28T10:00:00.000Z",
        streaming: false,
      },
    },
    {
      id: "completion-process-entry",
      kind: "message",
      createdAt: "2026-07-28T10:00:01.000Z",
      message: {
        id: MessageId.makeUnsafe("completion-process"),
        role: "assistant",
        text: Array.from({ length: 18 }, (_, index) => `Process detail ${index}`).join("\n\n"),
        turnId: COMPLETION_TURN_ID,
        createdAt: "2026-07-28T10:00:01.000Z",
        completedAt: "2026-07-28T10:00:02.000Z",
        streaming: false,
      },
    },
    {
      id: "completion-work-entry",
      kind: "work",
      createdAt: "2026-07-28T10:00:03.000Z",
      entry: {
        id: "completion-work",
        createdAt: "2026-07-28T10:00:03.000Z",
        label: "Verify completion",
        tone: "tool",
      },
    },
    {
      id: "completion-final-entry",
      kind: "message",
      createdAt: "2026-07-28T10:00:04.000Z",
      message: {
        id: MessageId.makeUnsafe("completion-final"),
        role: "assistant",
        text: "LATEST TURN RESULT",
        turnId: COMPLETION_TURN_ID,
        createdAt: "2026-07-28T10:00:04.000Z",
        ...(settled ? { completedAt: "2026-07-28T10:00:05.000Z" } : {}),
        streaming: !settled,
      },
    },
  ];
}

function CompletingTimeline() {
  const [settled, setSettled] = useState(false);
  const entries = completionTimelineEntries(settled);
  const scroll = useTranscriptScrollController({
    threadId: COMPLETION_THREAD_ID,
    activeThreadId: COMPLETION_THREAD_ID,
    activeTurnInProgress: !settled,
    composerStackedChromeHeight: 0,
    timelineEntries: entries,
  });

  return (
    <div>
      <button type="button" onClick={() => setSettled(true)}>
        Complete turn
      </button>
      <div style={{ height: 420 }}>
        <MessagesTimeline
          hasMessages
          isWorking={!settled}
          activeTurnInProgress={!settled}
          activeTurnId={COMPLETION_TURN_ID}
          activeTurnStartedAt="2026-07-28T10:00:00.000Z"
          timelineEntries={entries}
          listRef={scroll.legendListRef}
          followLiveOutput={!settled}
          turnDiffSummaryByAssistantMessageId={new Map()}
          nowIso="2026-07-28T10:00:05.000Z"
          expandedWorkGroups={{}}
          onToggleWorkGroup={() => {}}
          onOpenTurnDiff={() => {}}
          revertTurnCountByUserMessageId={new Map()}
          onRevertUserMessage={() => {}}
          isRevertingCheckpoint={false}
          onImageExpand={() => {}}
          onIsAtEndChange={scroll.onIsAtEndChange}
          onMessagesScroll={scroll.onMessagesScrollBase}
          onMessagesPointerCancel={scroll.onMessagesPointerCancelBase}
          onMessagesPointerDown={scroll.onMessagesPointerDownBase}
          onMessagesTouchMove={scroll.onMessagesTouchMoveBase}
          onMessagesTouchStart={scroll.onMessagesTouchStartBase}
          onMessagesWheel={scroll.onMessagesWheelBase}
          markdownCwd={undefined}
          resolvedTheme="light"
          timestampFormat="locale"
          workspaceRoot={undefined}
        />
      </div>
    </div>
  );
}

describe("MessagesTimeline settled process messages", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("hides process messages by default and reveals them from Worked for", async () => {
    const screen = await render(<SettledTimeline />);

    try {
      await expect.poll(() => document.body.textContent?.includes("Fixed.")).toBe(true);
      expect(document.body.textContent ?? "").toContain("Worked for");
      expect(document.body.textContent ?? "").not.toContain("Checking the implementation now.");

      const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.includes("Worked for"),
      );
      expect(trigger).toBeDefined();
      trigger?.click();

      await expect
        .poll(() => document.body.textContent?.includes("Checking the implementation now."))
        .toBe(true);
      expect(
        document.querySelector('[data-assistant-message-id="message-process"]'),
      ).not.toBeNull();
    } finally {
      await screen.unmount();
    }
  });

  it("keeps the newest Turn result visible after the process rows fold", async () => {
    const screen = await render(<CompletingTimeline />);

    try {
      await expect
        .poll(
          () =>
            document
              .querySelector('[data-assistant-message-id="completion-final"]')
              ?.getClientRects().length,
        )
        .toBeGreaterThan(0);
      document.querySelector<HTMLButtonElement>("button")?.click();

      await expect.poll(() => document.body.textContent?.includes("Worked for")).toBe(true);
      await new Promise<void>((resolve) =>
        window.setTimeout(resolve, TRANSCRIPT_AUTO_FOLLOW_SETTLE_DELAY_MS + 80),
      );

      const scrollContainer = document.querySelector<HTMLElement>(
        '[data-chat-scroll-container="true"]',
      );
      const latestResult = document.querySelector<HTMLElement>(
        '[data-assistant-message-id="completion-final"]',
      );
      expect(scrollContainer).not.toBeNull();
      expect(latestResult).not.toBeNull();
      const viewport = scrollContainer!.getBoundingClientRect();
      const result = latestResult!.getBoundingClientRect();
      expect(result.top).toBeGreaterThanOrEqual(viewport.top - 1);
      expect(result.bottom).toBeLessThanOrEqual(viewport.bottom + 1);
      expect(scrollContainer!.scrollTop).toBeGreaterThan(0);
    } finally {
      await screen.unmount();
    }
  });
});
