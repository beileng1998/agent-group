import { EventId, ThreadId, TurnId, type ProviderEvent } from "@agent-group/contracts";
import { describe, expect, it } from "vitest";

import { mapCodexRuntimeEvents } from "./codexRuntimeEventProjection.ts";
import {
  makeUnmappedProviderEventGate,
  MAX_UNMAPPED_PROVIDER_DATA_JSON_CHARS,
  sanitizeUnmappedProviderData,
  sanitizeUnmappedProviderEvent,
} from "./unmappedProviderEvents.ts";

function event(method: string, turn = "turn-unmapped"): ProviderEvent {
  return {
    id: EventId.makeUnsafe(`event-${method}-${turn}`),
    kind: "notification",
    provider: "codex",
    threadId: ThreadId.makeUnsafe("thread-unmapped"),
    turnId: TurnId.makeUnsafe(turn),
    createdAt: "2026-08-15T08:00:00.000Z",
    method,
  };
}

describe("unmapped provider event safety", () => {
  it("redacts and bounds diagnostic payloads", () => {
    const payload = {
      secretKey: "secret-key-value",
      nested: {
        message: "api_key=hunter2",
        authorization: "Bearer abc.def",
        cookieHeader: "Cookie: session=cookie-secret",
      },
      safe: "Cookie policy is strict",
      output: "x".repeat(MAX_UNMAPPED_PROVIDER_DATA_JSON_CHARS * 4),
    };

    const sanitized = sanitizeUnmappedProviderData(payload);
    const serialized = JSON.stringify(sanitized);
    expect(serialized.length).toBeLessThan(MAX_UNMAPPED_PROVIDER_DATA_JSON_CHARS);
    expect(serialized).not.toContain("secret-key-value");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("abc.def");
    expect(serialized).not.toContain("cookie-secret");
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("Cookie policy is strict");
    expect(serialized).toContain("__agentGroupTruncated");
  });

  it("surfaces one high-frequency fallback per turn and method", () => {
    const shouldSurface = makeUnmappedProviderEventGate(2);
    expect(shouldSurface(event("future/outputDelta"))).toBe(true);
    expect(shouldSurface(event("future/outputDelta"))).toBe(false);
    expect(shouldSurface(event("future/outputDelta", "turn-next"))).toBe(true);
    expect(shouldSurface(event("future/completed"))).toBe(true);
  });

  it("maps unknown Codex events to sanitized runtime diagnostics", () => {
    const native = {
      ...event("future/completed"),
      message: "token=top-secret",
      payload: { summary: "Finished safely", apiKey: "top-secret" },
    };
    const [mapped] = mapCodexRuntimeEvents(native, native.threadId);
    const sanitizedNative = sanitizeUnmappedProviderEvent(native);

    expect(mapped).toMatchObject({
      type: "event.unmapped",
      payload: {
        nativeType: "future/completed",
        detail: "Finished safely",
        data: { summary: "Finished safely", apiKey: "[REDACTED]" },
      },
      raw: { payload: { agentGroupSanitized: true } },
    });
    expect(JSON.stringify(sanitizedNative)).not.toContain("top-secret");
  });
});
