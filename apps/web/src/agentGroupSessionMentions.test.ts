import { describe, expect, it } from "vitest";

import {
  buildAgentGroupSessionMentionCandidates,
  rankAgentGroupSessionMentionCandidates,
} from "./agentGroupSessionMentions";

describe("Agent Group session mentions", () => {
  const threads = [
    thread("current", "group-one", "Current"),
    thread("research-a1b2c3", "group-one", "Research notes", "current"),
    thread("research-d4e5f6", "group-one", "Research notes"),
    thread("plan-123456", "group-one", "Release plan"),
    thread("other-123456", "group-two", "Other group"),
    { ...thread("archived-123456", "group-one", "Archived"), archivedAt: "2026-01-01" },
    { ...thread("subagent:worker", "group-one", "Worker"), subagentAgentId: "worker" },
  ];

  it("keeps only other active product sessions in the current group", () => {
    const candidates = buildAgentGroupSessionMentionCandidates({
      threads,
      activeThreadId: "current",
      activeProjectId: "group-one",
    });

    expect(candidates.map(({ sessionId }) => sessionId)).toEqual([
      "research-a1b2c3",
      "research-d4e5f6",
      "plan-123456",
    ]);
    expect(candidates.slice(0, 2).map(({ mentionName }) => mentionName)).toEqual([
      "Research notes · a1b2c3",
      "Research notes · d4e5f6",
    ]);
  });

  it("narrows by title, parent title, and session id", () => {
    const candidates = buildAgentGroupSessionMentionCandidates({
      threads,
      activeThreadId: "current",
      activeProjectId: "group-one",
    });

    expect(
      rankAgentGroupSessionMentionCandidates(candidates, "release").map((item) => item.title),
    ).toEqual(["Release plan"]);
    expect(
      rankAgentGroupSessionMentionCandidates(candidates, "current").map((item) => item.sessionId),
    ).toEqual(["research-a1b2c3"]);
    expect(
      rankAgentGroupSessionMentionCandidates(candidates, "d4e5f6").map((item) => item.sessionId),
    ).toEqual(["research-d4e5f6"]);
  });
});

function thread(
  id: string,
  projectId: string,
  title: string,
  parentThreadId: string | null = null,
) {
  return {
    id,
    projectId,
    title,
    parentThreadId,
    archivedAt: null,
    subagentAgentId: null,
    subagentNickname: null,
    subagentRole: null,
    sidechatSourceThreadId: null,
    forkSourceThreadId: null,
    handoff: null,
  };
}
