import { describe, expect, it } from "vitest";
import { EventId, ThreadId, TurnId, type ProviderRuntimeEvent } from "@agent-group/contracts";

import { isProviderChildRuntimeEvent } from "./providerRuntimeEventScope.ts";

function eventWithRefs(
  providerThreadId?: string,
  providerParentThreadId?: string,
): ProviderRuntimeEvent {
  return {
    type: "turn.completed",
    eventId: EventId.makeUnsafe("event-1"),
    provider: "claudeAgent",
    threadId: ThreadId.makeUnsafe("thread-1"),
    turnId: TurnId.makeUnsafe("turn-1"),
    createdAt: "2026-07-19T00:00:00.000Z",
    payload: { state: "completed" },
    providerRefs: {
      ...(providerThreadId ? { providerThreadId } : {}),
      ...(providerParentThreadId ? { providerParentThreadId } : {}),
    },
  };
}

describe("isProviderChildRuntimeEvent", () => {
  it("recognizes a provider child route", () => {
    expect(isProviderChildRuntimeEvent(eventWithRefs("child", "parent"))).toBe(true);
  });

  it("keeps parent and unscoped events on the parent lifecycle", () => {
    expect(isProviderChildRuntimeEvent(eventWithRefs("parent", "parent"))).toBe(false);
    expect(isProviderChildRuntimeEvent(eventWithRefs("parent"))).toBe(false);
    expect(isProviderChildRuntimeEvent(eventWithRefs())).toBe(false);
  });
});
