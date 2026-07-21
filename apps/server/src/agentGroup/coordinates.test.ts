import { ProjectId, ThreadId } from "@agent-group/contracts";
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery";
import { resolveAgentGroupSessionCoordinates } from "./coordinates";

const sessionId = ThreadId.makeUnsafe("session-1");
const groupId = ProjectId.makeUnsafe("group-1");

function queryFor(overrides: Record<string, unknown> = {}): ProjectionSnapshotQueryShape {
  const thread = {
    id: sessionId,
    projectId: groupId,
    parentThreadId: ThreadId.makeUnsafe("parent-1"),
    createdAt: "2026-07-17T00:00:00.000Z",
    subagentAgentId: null,
    subagentNickname: null,
    subagentRole: null,
    sidechatSourceThreadId: null,
    forkSourceThreadId: null,
    handoff: null,
    ...overrides,
  };
  return {
    getThreadShellById: () => Effect.succeed(Option.some(thread)),
    getProjectShellById: () =>
      Effect.succeed(
        Option.some({ id: groupId, kind: "project", workspaceRoot: "/canonical/group" }),
      ),
  } as unknown as ProjectionSnapshotQueryShape;
}

describe("Agent Group RPC coordinates", () => {
  it("derives workspace and parent metadata from server projections", async () => {
    await expect(
      Effect.runPromise(resolveAgentGroupSessionCoordinates(queryFor(), sessionId)),
    ).resolves.toEqual({
      workspaceRoot: "/canonical/group",
      groupId,
      sessionId,
      parentSessionId: ThreadId.makeUnsafe("parent-1"),
      createdAt: "2026-07-17T00:00:00.000Z",
    });
  });

  it("rejects provider-created subagent rows", async () => {
    await expect(
      Effect.runPromise(
        resolveAgentGroupSessionCoordinates(queryFor({ subagentAgentId: "worker" }), sessionId),
      ),
    ).rejects.toThrow("not an Agent Group session");
  });

  it("rejects temporary sidechats but accepts them after promotion", async () => {
    const sourceId = ThreadId.makeUnsafe("session-source");
    await expect(
      Effect.runPromise(
        resolveAgentGroupSessionCoordinates(
          queryFor({
            parentThreadId: null,
            sidechatSourceThreadId: sourceId,
            forkSourceThreadId: sourceId,
          }),
          sessionId,
        ),
      ),
    ).rejects.toThrow("not an Agent Group session");

    await expect(
      Effect.runPromise(
        resolveAgentGroupSessionCoordinates(
          queryFor({
            parentThreadId: sourceId,
            sidechatSourceThreadId: sourceId,
            forkSourceThreadId: null,
          }),
          sessionId,
        ),
      ),
    ).resolves.toMatchObject({
      sessionId,
      parentSessionId: sourceId,
    });
  });
});
