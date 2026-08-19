import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ThreadId,
  type OrchestrationReadModel,
} from "@agent-group/contracts";
import { isPromotedSidechatThread } from "@agent-group/shared/agentGroupSessions";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const NOW = "2026-07-27T00:00:00.000Z";
const PROJECT_ID = ProjectId.makeUnsafe("project-knowledge");
const SOURCE_ID = ThreadId.makeUnsafe("thread-main");
const CHILD_ID = ThreadId.makeUnsafe("thread-knowledge-child");

function thread(
  id: ThreadId,
  overrides: Partial<OrchestrationReadModel["threads"][number]> = {},
): OrchestrationReadModel["threads"][number] {
  return {
    id,
    projectId: PROJECT_ID,
    title: "Main session",
    modelSelection: { provider: "codex", model: "gpt-5-codex" },
    runtimeMode: "full-access",
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    envMode: "local",
    branch: null,
    worktreePath: null,
    parentThreadId: null,
    forkSourceThreadId: null,
    sidechatSourceThreadId: null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    handoff: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...overrides,
  };
}

function readModel(
  sourceOverrides: Partial<OrchestrationReadModel["threads"][number]> = {},
  extraThreads: ReadonlyArray<OrchestrationReadModel["threads"][number]> = [],
): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: NOW,
    projects: [
      {
        id: PROJECT_ID,
        title: "Knowledge project",
        workspaceRoot: "/tmp/knowledge-project",
        defaultModelSelection: null,
        scripts: [],
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ],
    threads: [thread(SOURCE_ID, sourceOverrides), ...extraThreads],
  };
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    type: "thread.knowledge-child.create" as const,
    commandId: CommandId.makeUnsafe("cmd-knowledge-child"),
    threadId: CHILD_ID,
    sourceThreadId: SOURCE_ID,
    projectId: PROJECT_ID,
    title: "Async rendering",
    modelSelection: { provider: "codex" as const, model: "gpt-5-codex" },
    runtimeMode: "full-access" as const,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    envMode: "local" as const,
    branch: null,
    worktreePath: null,
    importedMessages: [
      {
        messageId: MessageId.makeUnsafe("message-imported-source"),
        role: "user" as const,
        text: "Knowledge source snapshot",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    createdAt: NOW,
    ...overrides,
  };
}

describe("thread.knowledge-child.create", () => {
  it("creates a child session that is born promoted with imported messages", async () => {
    const current = readModel();
    const result = await Effect.runPromise(
      decideOrchestrationCommand({ command: command(), readModel: current }),
    );
    const events = Array.isArray(result) ? result : [result];
    const created = events[0];
    expect(created?.type).toBe("thread.created");
    if (!created || created.type !== "thread.created") return;
    expect(created.payload).toMatchObject({
      threadId: CHILD_ID,
      parentThreadId: SOURCE_ID,
      forkSourceThreadId: null,
      sidechatSourceThreadId: SOURCE_ID,
      title: "Async rendering",
    });

    const imported = events[1];
    expect(imported?.type).toBe("thread.message-sent");
    if (imported?.type === "thread.message-sent") {
      expect(imported.payload).toMatchObject({
        threadId: CHILD_ID,
        messageId: "message-imported-source",
        source: "fork-import",
      });
    }

    let projected = current;
    for (const [index, event] of events.entries()) {
      projected = await Effect.runPromise(
        projectEvent(projected, { ...event, sequence: index + 2 }),
      );
    }
    const child = projected.threads.find((candidate) => candidate.id === CHILD_ID);
    expect(child).toBeDefined();
    if (!child) return;
    expect(isPromotedSidechatThread(child)).toBe(true);
  });

  it("rejects a source thread that is not an Agent Group session", async () => {
    // A temporary sidechat (sidechatSourceThreadId set, still a fork) is not a session.
    const host = ThreadId.makeUnsafe("thread-host");
    const current = readModel({ sidechatSourceThreadId: host, forkSourceThreadId: host });
    await expect(
      Effect.runPromise(decideOrchestrationCommand({ command: command(), readModel: current })),
    ).rejects.toThrow("not an Agent Group session");
  });

  it("rejects when the target thread already exists", async () => {
    const current = readModel({}, [thread(CHILD_ID)]);
    await expect(
      Effect.runPromise(decideOrchestrationCommand({ command: command(), readModel: current })),
    ).rejects.toThrow();
  });

  it("rejects a source thread from a different project", async () => {
    const current = readModel({ projectId: ProjectId.makeUnsafe("project-elsewhere") });
    await expect(
      Effect.runPromise(decideOrchestrationCommand({ command: command(), readModel: current })),
    ).rejects.toThrow("different project");
  });
});
