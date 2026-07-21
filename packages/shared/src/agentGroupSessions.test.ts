import { describe, expect, it } from "vitest";

import {
  TEMPORARY_SIDECHAT_PLACEHOLDER_TITLE,
  formatTemporarySidechatTitle,
  isAgentGroupSessionThread,
  isPromotedSidechatThread,
  isTemporarySidechatThread,
  promotedSidechatTitle,
  stripTemporarySidechatTitlePrefix,
} from "./agentGroupSessions";

describe("Agent Group session classification", () => {
  it("keeps unpromoted sidechats temporary and out of the durable session tree", () => {
    const sidechat = {
      id: "sidechat",
      parentThreadId: null,
      sidechatSourceThreadId: "main",
      forkSourceThreadId: "main",
    };

    expect(isTemporarySidechatThread(sidechat)).toBe(true);
    expect(isPromotedSidechatThread(sidechat)).toBe(false);
    expect(isAgentGroupSessionThread(sidechat)).toBe(false);
  });

  it("recognizes a promoted sidechat as a child session while retaining its source", () => {
    const child = {
      id: "sidechat",
      parentThreadId: "main",
      sidechatSourceThreadId: "main",
      forkSourceThreadId: null,
    };

    expect(isTemporarySidechatThread(child)).toBe(false);
    expect(isPromotedSidechatThread(child)).toBe(true);
    expect(isAgentGroupSessionThread(child)).toBe(true);
  });

  it("keeps runtime subagents and ordinary forks out of the session tree", () => {
    expect(isAgentGroupSessionThread({ id: "subagent:one" })).toBe(false);
    expect(isAgentGroupSessionThread({ id: "fork", forkSourceThreadId: "main" })).toBe(false);
  });

  it("turns the temporary title into a durable child-session title", () => {
    expect(promotedSidechatTitle("Sidechat: Why this branch?")).toBe("Why this branch?");
    expect(promotedSidechatTitle("Sidechat: ")).toBe("Child session");
    expect(promotedSidechatTitle(TEMPORARY_SIDECHAT_PLACEHOLDER_TITLE)).toBe("Child session");
  });

  it("formats one recognizable placeholder for temporary sidechats", () => {
    expect(TEMPORARY_SIDECHAT_PLACEHOLDER_TITLE).toBe("Sidechat: New thread");
    expect(stripTemporarySidechatTitlePrefix(TEMPORARY_SIDECHAT_PLACEHOLDER_TITLE)).toBe(
      "New thread",
    );
    expect(formatTemporarySidechatTitle("Investigate cache misses")).toBe(
      "Sidechat: Investigate cache misses",
    );
    expect(formatTemporarySidechatTitle("Sidechat: Investigate cache misses")).toBe(
      "Sidechat: Investigate cache misses",
    );
  });
});
