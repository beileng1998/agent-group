import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import {
  EventId,
  type ProviderRuntimeEvent,
  ThreadId,
  TurnId,
} from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import type { PiSessionContext } from "./piAdapterCore.ts";
import { makePiSessionEventConsumer } from "./piSessionEventConsumer.ts";

const usage: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-responses",
    provider: "openai",
    model: "gpt-test",
    usage,
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function messageUpdate(
  message: AssistantMessage,
  assistantMessageEvent: AssistantMessageEvent,
): AgentSessionEvent {
  return { type: "message_update", message, assistantMessageEvent };
}

describe("makePiSessionEventConsumer", () => {
  it("publishes one live reasoning item from Pi thinking lifecycle events", () => {
    const threadId = ThreadId.makeUnsafe("thread-pi-thinking");
    const turnId = TurnId.makeUnsafe("turn-pi-thinking");
    const events: ProviderRuntimeEvent[] = [];
    let eventSequence = 0;
    const context = {
      session: { threadId },
      turns: [{ id: turnId, items: [] }],
      activeTurnId: turnId,
      activeAssistantItemId: undefined,
      activeReasoningItemId: undefined,
      activeReasoningText: "",
      activeReasoningLastPublishedAt: undefined,
      activeToolItems: new Map(),
    } as unknown as PiSessionContext;
    const consumer = makePiSessionEventConsumer({
      makeEventBase: () => ({
        eventId: EventId.makeUnsafe(`event-${eventSequence++}`),
        provider: "pi",
        threadId,
        turnId,
        createdAt: "2026-07-29T10:00:00.000Z",
      }),
      offerRuntimeEvent: (event) => events.push(event),
      offerRuntimeError: () => {},
    });

    const emptyThinking = assistant([{ type: "thinking", thinking: "" }]);
    consumer.handleSessionEvent(
      context,
      messageUpdate(emptyThinking, {
        type: "thinking_start",
        contentIndex: 0,
        partial: emptyThinking,
      }),
    );
    const firstPartial = assistant([{ type: "thinking", thinking: "Inspecting" }]);
    consumer.handleSessionEvent(
      context,
      messageUpdate(firstPartial, {
        type: "thinking_delta",
        contentIndex: 0,
        delta: "Inspecting",
        partial: firstPartial,
      }),
    );
    const finalThinking = assistant([{ type: "thinking", thinking: "Inspecting the event flow." }]);
    consumer.handleSessionEvent(
      context,
      messageUpdate(finalThinking, {
        type: "thinking_delta",
        contentIndex: 0,
        delta: " the event flow.",
        partial: finalThinking,
      }),
    );
    consumer.handleSessionEvent(
      context,
      messageUpdate(finalThinking, {
        type: "thinking_end",
        contentIndex: 0,
        content: "Inspecting the event flow.",
        partial: finalThinking,
      }),
    );

    const reasoningEvents = events.filter(
      (event) =>
        (event.type === "item.started" ||
          event.type === "item.updated" ||
          event.type === "item.completed") &&
        event.payload.itemType === "reasoning",
    );
    const reasoningItemId = reasoningEvents[0]?.itemId;
    expect(reasoningEvents.map((event) => event.type)).toEqual([
      "item.started",
      "item.updated",
      "item.updated",
      "item.completed",
    ]);
    expect(reasoningEvents.every((event) => event.itemId === reasoningItemId)).toBe(true);
    expect(reasoningEvents.at(-1)).toMatchObject({
      type: "item.completed",
      payload: {
        status: "completed",
        title: "Thinking",
        detail: "Inspecting the event flow.",
      },
    });
    expect(
      events.filter(
        (event) =>
          event.type === "content.delta" && event.payload.streamKind === "reasoning_text",
      ),
    ).toHaveLength(2);
    expect(context.activeReasoningItemId).toBeUndefined();
    expect(context.activeReasoningText).toBe("");
  });
});
