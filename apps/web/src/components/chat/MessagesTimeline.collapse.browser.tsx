// FILE: MessagesTimeline.collapse.browser.tsx
// Purpose: Browser regression for settled process-message disclosure behavior.
// Layer: Vitest browser tests

import "../../index.css";

import { MessageId, TurnId } from "@agent-group/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { MessagesTimeline } from "./MessagesTimeline";

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
            id: "entry-thinking",
            kind: "work",
            createdAt: "2026-07-28T10:00:03.500Z",
            entry: {
              id: "thinking-1",
              createdAt: "2026-07-28T10:00:03.500Z",
              label: "Thinking",
              detail: "The implementation now follows the Pi lifecycle.",
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

function LiveTimeline() {
  const turnId = TurnId.makeUnsafe("turn-live");
  return (
    <div style={{ height: 420 }}>
      <MessagesTimeline
        hasMessages
        isWorking
        activeTurnInProgress
        activeTurnId={turnId}
        activeTurnStartedAt="2026-07-29T10:00:00.000Z"
        timelineEntries={[
          {
            id: "entry-live-thinking",
            kind: "work",
            createdAt: "2026-07-29T10:00:01.000Z",
            entry: {
              id: "live-thinking",
              createdAt: "2026-07-29T10:00:01.000Z",
              turnId,
              label: "Thinking",
              toolTitle: "Thinking",
              toolCallId: "pi-reasoning-live",
              detail: "Inspecting the Pi event lifecycle.",
              tone: "tool",
            },
          },
          {
            id: "entry-live-read",
            kind: "work",
            createdAt: "2026-07-29T10:00:02.000Z",
            entry: {
              id: "live-read",
              createdAt: "2026-07-29T10:00:02.000Z",
              turnId,
              label: "Read adapter source",
              tone: "tool",
            },
          },
          {
            id: "entry-live-test",
            kind: "work",
            createdAt: "2026-07-29T10:00:03.000Z",
            entry: {
              id: "live-test",
              createdAt: "2026-07-29T10:00:03.000Z",
              turnId,
              label: "Run focused checks",
              tone: "tool",
            },
          },
        ]}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-07-29T10:00:04.000Z"
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
      expect(document.body.textContent ?? "").not.toContain(
        "The implementation now follows the Pi lifecycle.",
      );

      const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.includes("Worked for"),
      );
      expect(trigger).toBeDefined();
      trigger?.click();

      await expect
        .poll(() => document.body.textContent?.includes("Checking the implementation now."))
        .toBe(true);
      expect(document.body.textContent ?? "").toContain(
        "The implementation now follows the Pi lifecycle.",
      );
      expect(
        document.querySelector('[data-assistant-message-id="message-process"]'),
      ).not.toBeNull();
    } finally {
      await screen.unmount();
    }
  });

  it("shows Pi thinking live while keeping tool details closed", async () => {
    const screen = await render(<LiveTimeline />);

    try {
      await expect.poll(() => document.body.textContent?.includes("Working for")).toBe(true);
      expect(document.body.textContent ?? "").toContain("Inspecting the Pi event lifecycle.");
      expect(document.body.textContent ?? "").toContain("Process 2 tools");
      expect(document.body.textContent ?? "").not.toContain("Read adapter source");
      expect(document.querySelectorAll('[data-timeline-row-kind="working-header"]')).toHaveLength(1);
      expect(document.querySelectorAll('[data-timeline-row-kind="working"]')).toHaveLength(0);

      const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.includes("Process"),
      );
      expect(trigger).toBeDefined();
      trigger?.click();

      await expect.poll(() => document.body.textContent?.includes("Read adapter source")).toBe(true);
      expect(document.body.textContent ?? "").toContain("Run focused checks");
    } finally {
      await screen.unmount();
    }
  });
});
