import { describe, expect, it } from "vitest";
import { TurnId } from "@agent-group/contracts";

import { resolveCodexCollaborationRoute } from "./codexCollaborationRouting.ts";

describe("resolveCodexCollaborationRoute", () => {
  it("routes an unmapped child through the active provider thread", () => {
    expect(
      resolveCodexCollaborationRoute({
        providerThreadId: "provider-child",
        activeProviderThreadId: "provider-parent",
        hasActiveParentTurn: true,
      }),
    ).toEqual({
      providerThreadId: "provider-child",
      providerParentThreadId: "provider-parent",
      isChildConversation: true,
    });
  });

  it("prefers an explicit collaboration mapping", () => {
    expect(
      resolveCodexCollaborationRoute({
        parentTurnId: TurnId.makeUnsafe("turn-parent"),
        providerThreadId: "provider-child",
        mappedProviderParentThreadId: "provider-mapped-parent",
        activeProviderThreadId: "provider-active-parent",
        hasActiveParentTurn: true,
      }),
    ).toEqual({
      parentTurnId: "turn-parent",
      providerThreadId: "provider-child",
      providerParentThreadId: "provider-mapped-parent",
      isChildConversation: true,
    });
  });

  it("does not infer a child route when the parent turn is inactive", () => {
    expect(
      resolveCodexCollaborationRoute({
        providerThreadId: "provider-other",
        activeProviderThreadId: "provider-parent",
        hasActiveParentTurn: false,
      }),
    ).toEqual({
      providerThreadId: "provider-other",
      isChildConversation: false,
    });
  });

  it("keeps the active provider thread on the parent route", () => {
    expect(
      resolveCodexCollaborationRoute({
        providerThreadId: "provider-parent",
        activeProviderThreadId: "provider-parent",
        hasActiveParentTurn: true,
      }),
    ).toEqual({
      providerThreadId: "provider-parent",
      isChildConversation: false,
    });
  });
});
