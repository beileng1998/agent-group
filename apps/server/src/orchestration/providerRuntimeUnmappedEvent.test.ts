import { EventId, ProviderRuntimeEvent, ThreadId, TurnId } from "@agent-group/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { runtimeEventToActivities } from "./providerRuntimeActivityProjection.ts";

describe("unmapped provider activity projection", () => {
  it("keeps a bounded native label and safe detail visible", () => {
    const event: ProviderRuntimeEvent = {
      type: "event.unmapped",
      eventId: EventId.makeUnsafe("event-unmapped"),
      provider: "codex",
      threadId: ThreadId.makeUnsafe("thread-unmapped"),
      turnId: TurnId.makeUnsafe("turn-unmapped"),
      createdAt: "2026-08-15T08:00:00.000Z",
      payload: {
        nativeType: "item/future/completed",
        detail: "Finished safely",
        data: { password: "must-not-survive", note: "Authorization: Bearer secret" },
      },
    };

    expect(() => Schema.decodeUnknownSync(ProviderRuntimeEvent)(event)).not.toThrow();

    const [activity] = runtimeEventToActivities(event);

    expect(activity).toMatchObject({
      kind: "provider.event.unmapped",
      summary: "item/future/completed",
      payload: {
        nativeEventType: "item/future/completed",
        detail: "Finished safely",
      },
    });
    expect(JSON.stringify(activity?.payload)).not.toContain("must-not-survive");
    expect(JSON.stringify(activity?.payload)).not.toContain("Bearer secret");
  });
});
