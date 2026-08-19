import { describe, expect, it } from "vitest";

import {
  excludeRuntimeSubagentCompletionCandidates,
  excludeTemporarySidechatNotificationCandidates,
} from "./taskCompletion.logic";

describe("sidechat notification policy", () => {
  it("silences temporary sidechats but keeps regular and promoted Sessions", () => {
    const candidates = [
      { threadId: "main", kind: "completion" },
      { threadId: "temporary-sidechat", kind: "completion" },
      { threadId: "promoted-sidechat", kind: "completion" },
    ] as const;

    expect(
      excludeTemporarySidechatNotificationCandidates(candidates, [
        { id: "main" },
        {
          id: "temporary-sidechat",
          sidechatSourceThreadId: "main",
        },
        {
          id: "promoted-sidechat",
          sidechatSourceThreadId: "main",
          parentThreadId: "main",
        },
      ]),
    ).toEqual([
      { threadId: "main", kind: "completion" },
      { threadId: "promoted-sidechat", kind: "completion" },
    ]);
  });

  it("uses the latest snapshot when a sidechat is promoted", () => {
    const candidate = [{ threadId: "sidechat" }];

    expect(
      excludeTemporarySidechatNotificationCandidates(candidate, [
        { id: "sidechat", sidechatSourceThreadId: "main" },
        {
          id: "sidechat",
          sidechatSourceThreadId: "main",
          parentThreadId: "main",
        },
      ]),
    ).toEqual(candidate);
  });
});

describe("runtime subagent completion policy", () => {
  it("keeps parent Sessions quiet when their runtime subagents settle", () => {
    const candidates = [
      { threadId: "main" },
      { threadId: "subagent:main:provider-1" },
      { threadId: "metadata-subagent" },
    ];

    expect(
      excludeRuntimeSubagentCompletionCandidates(candidates, [
        { id: "main" },
        { id: "subagent:main:provider-1", parentThreadId: "main" },
        { id: "metadata-subagent", parentThreadId: "main", subagentAgentId: "reviewer" },
      ]),
    ).toEqual([{ threadId: "main" }]);
  });
});
