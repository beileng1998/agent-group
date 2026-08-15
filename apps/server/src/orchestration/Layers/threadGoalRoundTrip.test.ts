import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ThreadId,
} from "@agent-group/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { describe, expect, it } from "vitest";

import { ServerConfig } from "../../config";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery";
import { OrchestrationEngineLive } from "./OrchestrationEngine";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery";

async function createSystem() {
  const layer = OrchestrationEngineLive.pipe(
    Layer.provideMerge(OrchestrationProjectionPipelineLive),
    Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(OrchestrationCommandReceiptRepositoryLive),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "goal-roundtrip-" })),
    Layer.provideMerge(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(layer);
  return {
    engine: await runtime.runPromise(Effect.service(OrchestrationEngineService)),
    query: await runtime.runPromise(Effect.service(ProjectionSnapshotQuery)),
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

describe("thread goal persistence", () => {
  it("round-trips goal state, timing, pause, and achievement history", async () => {
    const system = await createSystem();
    const projectId = ProjectId.makeUnsafe("project-goal");
    const threadId = ThreadId.makeUnsafe("thread-goal");
    const createdAt = "2026-08-15T00:00:00.000Z";
    try {
      await system.run(
        system.engine.dispatch({
          type: "project.create",
          commandId: CommandId.makeUnsafe("cmd-project-goal"),
          projectId,
          title: "Goal project",
          workspaceRoot: "/tmp/project-goal",
          defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
          createdAt,
        }),
      );
      await system.run(
        system.engine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-thread-goal"),
          threadId,
          projectId,
          title: "Goal thread",
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
        }),
      );
      await system.run(
        system.engine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe("cmd-goal-set"),
          threadId,
          goal: "Ship the feature",
        }),
      );

      let detail = Option.getOrThrow(
        await system.run(system.query.getThreadDetailById(threadId)),
      );
      expect(detail.goal).toBe("Ship the feature");
      expect(detail.goalStartedAt).toEqual(expect.any(String));
      expect(detail.goalPausedAt).toBeNull();
      const shell = (await system.run(system.query.getShellSnapshot())).threads.find(
        (thread) => thread.id === threadId,
      );
      expect(shell).toMatchObject({ goal: "Ship the feature", goalPausedAt: null });

      await system.run(
        system.engine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe("cmd-goal-pause"),
          threadId,
          goalPaused: true,
        }),
      );
      detail = Option.getOrThrow(await system.run(system.query.getThreadDetailById(threadId)));
      expect(detail.goalPausedAt).toEqual(expect.any(String));

      await system.run(
        system.engine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe("cmd-goal-complete"),
          threadId,
          goalAchieved: true,
        }),
      );
      detail = Option.getOrThrow(await system.run(system.query.getThreadDetailById(threadId)));
      expect(detail).toMatchObject({ goal: "", goalStartedAt: null, goalPausedAt: null });
      expect(detail.goalAchievements?.[0]).toMatchObject({ goal: "Ship the feature" });
    } finally {
      await system.dispose();
    }
  });
});
