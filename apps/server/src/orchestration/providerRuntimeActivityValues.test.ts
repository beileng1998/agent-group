import { EventId, type ProviderRuntimeEvent, ThreadId } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import { buildConfiguredContextWindowPayload } from "./providerRuntimeActivityValues";

function configuredEvent(config: Record<string, unknown>): ProviderRuntimeEvent {
  return {
    eventId: EventId.makeUnsafe("event-configured"),
    provider: "claudeAgent",
    threadId: ThreadId.makeUnsafe("thread-configured"),
    createdAt: "2026-08-15T00:00:00.000Z",
    type: "session.configured",
    payload: { config },
  };
}

describe("buildConfiguredContextWindowPayload", () => {
  it("prefers the canonical auto-compact window over the legacy field", () => {
    expect(
      buildConfiguredContextWindowPayload(
        configuredEvent({ autoCompactWindow: "1m", contextWindow: "200k" }),
      ),
    ).toEqual({ contextWindow: "1m", maxTokens: 1_000_000 });
  });

  it("continues to read the legacy context window", () => {
    expect(buildConfiguredContextWindowPayload(configuredEvent({ contextWindow: "200k" }))).toEqual(
      { contextWindow: "200k", maxTokens: 200_000 },
    );
  });
});
