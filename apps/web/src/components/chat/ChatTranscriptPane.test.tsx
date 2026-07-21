import { MessageId, ThreadId, ThreadMarkerId, type ThreadMarker } from "@agent-group/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import { createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatTranscriptPane } from "./ChatTranscriptPane";

function renderTranscriptPaneMarkup(
  props: Partial<ComponentProps<typeof ChatTranscriptPane>> = {},
) {
  return renderToStaticMarkup(
    <ChatTranscriptPane
      activeThreadId="thread-1"
      activeTurnId={null}
      activeTurnInProgress={false}
      activeTurnStartedAt={null}
      chatFontSizePx={14}
      emptyStateProjectName={undefined}
      hasMessages
      isRevertingCheckpoint={false}
      isWorking={false}
      worktreeSetup={null}
      followLiveOutput={false}
      listRef={createRef<LegendListRef | null>()}
      markdownCwd={undefined}
      onExpandTimelineImage={() => {}}
      onIsAtEndChange={() => {}}
      onMessagesClickCapture={() => {}}
      onMessagesMouseUp={() => {}}
      onMessagesPointerCancel={() => {}}
      onMessagesPointerDown={() => {}}
      onMessagesPointerUp={() => {}}
      onMessagesScroll={() => {}}
      onMessagesTouchEnd={() => {}}
      onMessagesTouchMove={() => {}}
      onMessagesTouchStart={() => {}}
      onMessagesWheel={() => {}}
      onOpenTurnDiff={() => {}}
      onOpenThread={(_threadId: ThreadId) => {}}
      onRevertUserMessage={(_messageId: MessageId) => {}}
      onScrollToBottom={() => {}}
      resolvedTheme="light"
      revertTurnCountByUserMessageId={new Map()}
      scrollButtonVisible
      terminalWorkspaceTerminalTabActive={false}
      timelineEntries={[]}
      timestampFormat="locale"
      turnDiffSummaryByAssistantMessageId={new Map()}
      workspaceRoot={undefined}
      {...props}
    />,
  );
}

describe("ChatTranscriptPane", () => {
  it("renders agent activity detail in place of the message timeline", () => {
    const markup = renderTranscriptPaneMarkup({
      agentActivityDetail: {
        id: "agent-task-1",
        title: "Agent task",
        summary: "Checked the sidebar issue.",
        primaryEntry: {
          id: "agent-task-1",
          createdAt: "2026-06-05T00:00:00.000Z",
          label: "Agent task",
          tone: "tool",
          itemType: "collab_agent_tool_call",
          detail: "Checked the sidebar issue.",
        },
        entries: [
          {
            id: "agent-task-1",
            createdAt: "2026-06-05T00:00:00.000Z",
            label: "Agent task",
            tone: "tool",
            itemType: "collab_agent_tool_call",
            detail: "Checked the sidebar issue.",
          },
        ],
      },
      onCloseAgentActivityDetail: () => {},
    });

    expect(markup).toContain('data-agent-activity-detail="true"');
    expect(markup).toContain("Back");
    expect(markup).toContain("Checked the sidebar issue.");
    expect(markup).not.toContain("Scroll to bottom");
  });

  it("centers the scroll button inside the inset chat column", () => {
    const markup = renderTranscriptPaneMarkup({
      contentInsetRightPx: 360,
      scrollButtonVisible: true,
    });

    expect(markup).toContain('style="padding-right:360px"');
    expect(markup).toContain("Scroll to bottom");
  });

  it("renders pins and highlights as distinct shortcuts in the message trail", () => {
    const assistantMessageId = MessageId.makeUnsafe("assistant-1");
    const threadMarker: ThreadMarker = {
      id: ThreadMarkerId.makeUnsafe("marker-1"),
      messageId: assistantMessageId,
      startOffset: 0,
      endOffset: 12,
      selectedText: "Saved answer",
      prefix: "",
      suffix: "",
      style: "highlight",
      color: "blue",
      note: "Keep this",
      label: null,
      done: false,
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
    };
    const markup = renderTranscriptPaneMarkup({
      pinnedMessageIds: new Set([assistantMessageId]),
      threadMarkers: [threadMarker],
      timelineEntries: [
        {
          id: "user-entry-1",
          kind: "message",
          createdAt: "2026-07-21T00:00:00.000Z",
          message: {
            id: MessageId.makeUnsafe("user-1"),
            role: "user",
            text: "Question",
            streaming: false,
            turnId: null,
            createdAt: "2026-07-21T00:00:00.000Z",
          },
        },
        {
          id: "assistant-entry-1",
          kind: "message",
          createdAt: "2026-07-21T00:00:01.000Z",
          message: {
            id: assistantMessageId,
            role: "assistant",
            text: "Saved answer",
            streaming: false,
            turnId: null,
            createdAt: "2026-07-21T00:00:01.000Z",
          },
        },
      ],
    });

    expect(markup).toContain('data-message-trail-kind="turn"');
    expect(markup).toContain('data-message-trail-kind="pin"');
    expect(markup).toContain('data-message-trail-kind="highlight"');
    expect(markup).toContain('aria-label="Pinned message: Saved answer"');
    expect(markup).toContain('aria-label="Highlight: Saved answer"');
    expect(markup).toContain("bg-[#60a5fa]");
  });
});
