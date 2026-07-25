import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ThreadId,
  type OrchestrationReadModel,
} from "@agent-group/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider";
import { projectEvent } from "./projector";

const now = "2026-07-25T00:00:00.000Z";
const projectId = ProjectId.makeUnsafe("project-terminal-model");
const threadId = ThreadId.makeUnsafe("thread-terminal-model");

const readModel: OrchestrationReadModel = {
  snapshotSequence: 1,
  updatedAt: now,
  projects: [
    {
      id: projectId,
      title: "Project",
      workspaceRoot: "/workspace",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ],
  threads: [
    {
      id: threadId,
      projectId,
      title: "Thread",
      modelSelection: { provider: "codex", model: "gpt-5.2-codex" },
      runtimeMode: "full-access",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      envMode: "local",
      branch: null,
      worktreePath: null,
      parentThreadId: null,
      forkSourceThreadId: null,
      sidechatSourceThreadId: null,
      latestTurn: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      handoff: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    },
  ],
};

describe("thread.terminal-model.observe", () => {
  it("emits the canonical thread metadata event", async () => {
    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.terminal-model.observe",
          commandId: CommandId.makeUnsafe("cmd-terminal-model"),
          threadId,
          modelSelection: {
            provider: "codex",
            model: "gpt-5.3-codex",
            options: { reasoningEffort: "xhigh", fastMode: true },
          },
          terminalRuntimeFence: {
            revision: 3,
            generation: "generation-3",
          },
          createdAt: now,
        },
        readModel,
      }),
    );
    const event = Array.isArray(result) ? result[0] : result;

    expect(event).toMatchObject({
      type: "thread.meta-updated",
      occurredAt: now,
      metadata: { adapterKey: "terminal" },
      payload: {
        threadId,
        modelSelection: {
          provider: "codex",
          model: "gpt-5.3-codex",
          options: { reasoningEffort: "xhigh", fastMode: true },
        },
        updatedAt: now,
      },
    });
    if (!event) throw new Error("Expected a terminal model metadata event.");
    const projected = await Effect.runPromise(
      projectEvent(readModel, { ...event, sequence: 2 }),
    );
    expect(projected.threads[0]?.modelSelection).toEqual({
      provider: "codex",
      model: "gpt-5.3-codex",
      options: { reasoningEffort: "xhigh", fastMode: true },
    });
  });
});
