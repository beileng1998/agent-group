import { EventId, type OrchestrationThreadActivity } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import { formatAgentActivityEntryTitle } from "./components/chat/agentActivity.logic";
import { toolWorkEntryHeading } from "./components/chat/MessagesTimeline.workEntryModel";
import { deriveWorkLogEntries } from "./session-logic";

describe("unmapped provider work log", () => {
  it("uses the native type and safe detail without exposing raw data", () => {
    const activity: OrchestrationThreadActivity = {
      id: EventId.makeUnsafe("unmapped-provider-event"),
      createdAt: "2026-08-15T08:00:00.000Z",
      kind: "provider.event.unmapped",
      summary: "done",
      tone: "info",
      turnId: null,
      payload: {
        nativeEventType: "done",
        detail: "Safe provider summary",
        data: { rawOutput: { stdout: "must-not-render" } },
      },
    };

    const [entry] = deriveWorkLogEntries([activity], undefined);

    expect(entry).toMatchObject({
      activityKind: "provider.event.unmapped",
      nativeEventType: "done",
      detail: "Safe provider summary",
    });
    expect(entry?.preview).toBeUndefined();
    expect(formatAgentActivityEntryTitle(entry!)).toBe("Done");
    expect(toolWorkEntryHeading(entry!)).toBe("Done");
  });
});
