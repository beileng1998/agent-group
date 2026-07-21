import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ThreadId,
  type OrchestrationReadModel,
} from "@agent-group/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const NOW = "2026-07-18T00:00:00.000Z";
const PROJECT_ID = ProjectId.makeUnsafe("project-sidechat");
const SOURCE_ID = ThreadId.makeUnsafe("thread-main");
const SIDECHAT_ID = ThreadId.makeUnsafe("thread-sidechat");

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
  sidechatOverrides: Partial<OrchestrationReadModel["threads"][number]> = {},
): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: NOW,
    projects: [
      {
        id: PROJECT_ID,
        title: "Sidechat project",
        workspaceRoot: "/tmp/sidechat-project",
        defaultModelSelection: null,
        scripts: [],
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ],
    threads: [
      thread(SOURCE_ID),
      thread(SIDECHAT_ID, {
        title: "Sidechat: Explain the selection",
        forkSourceThreadId: SOURCE_ID,
        sidechatSourceThreadId: SOURCE_ID,
        ...sidechatOverrides,
      }),
    ],
  };
}

describe("thread.sidechat.promote", () => {
  it("turns an idle sidechat into a child session without losing source provenance", async () => {
    const current = readModel();
    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.sidechat.promote",
          commandId: CommandId.makeUnsafe("cmd-promote-sidechat"),
          threadId: SIDECHAT_ID,
        },
        readModel: current,
      }),
    );
    const event = Array.isArray(result) ? result[0] : result;
    expect(event?.type).toBe("thread.meta-updated");
    if (!event || event.type !== "thread.meta-updated") return;
    expect(event.payload).toMatchObject({
      threadId: SIDECHAT_ID,
      title: "Explain the selection",
      parentThreadId: SOURCE_ID,
      forkSourceThreadId: null,
    });

    const projected = await Effect.runPromise(projectEvent(current, { ...event, sequence: 2 }));
    expect(projected.threads.find((candidate) => candidate.id === SIDECHAT_ID)).toMatchObject({
      parentThreadId: SOURCE_ID,
      forkSourceThreadId: null,
      sidechatSourceThreadId: SOURCE_ID,
    });
  });

  it("rejects promotion while the sidechat has an active turn", async () => {
    const current = readModel({
      latestTurn: {
        turnId: "turn-running" as never,
        state: "running",
        requestedAt: NOW,
        startedAt: NOW,
        completedAt: null,
        assistantMessageId: null,
      },
    });

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.sidechat.promote",
            commandId: CommandId.makeUnsafe("cmd-promote-running-sidechat"),
            threadId: SIDECHAT_ID,
          },
          readModel: current,
        }),
      ),
    ).rejects.toThrow("must finish its active turn");
  });

  it("allows promotion after a provider binding has returned to idle", async () => {
    const current = readModel({
      session: {
        threadId: SIDECHAT_ID,
        status: "running",
        providerName: "codex",
        runtimeMode: "approval-required",
        activeTurnId: null,
        lastError: null,
        updatedAt: NOW,
      },
    });

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.sidechat.promote",
            commandId: CommandId.makeUnsafe("cmd-promote-idle-sidechat"),
            threadId: SIDECHAT_ID,
          },
          readModel: current,
        }),
      ),
    ).resolves.toMatchObject({ type: "thread.meta-updated" });
  });
});
