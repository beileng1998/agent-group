import { ProjectId, ThreadId, type OrchestrationReadModel } from "@agent-group/contracts";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { makeExecutionAdapterAuthority } from "../ExecutionAdapterAuthority";
import { withProjectStructuredAdmission } from "./executionAdapterProjectAdmission";

const projectId = ProjectId.makeUnsafe("project-root-change");
const threadId = ThreadId.makeUnsafe("thread-root-change");
const readModel = {
  threads: [{ id: threadId, projectId, deletedAt: null }],
} as unknown as OrchestrationReadModel;

describe("withProjectStructuredAdmission", () => {
  it("rejects a canonical root mutation while any Project Thread is terminal-owned", async () => {
    const authority = await Effect.runPromise(
      makeExecutionAdapterAuthority({
        persist: () => Effect.void,
        now: () => new Date("2026-07-26T00:00:00.000Z"),
      }),
    );
    await Effect.runPromise(
      authority.beginTerminalSwitch({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-root-change",
        providerSessionId: null,
        startedAt: "2026-07-26T00:00:00.000Z",
      }),
    );
    let mutated = false;

    const exit = await Effect.runPromiseExit(
      withProjectStructuredAdmission({
        authority,
        readModel,
        projectId,
        claimId: "project:root-change",
        operation: Effect.sync(() => {
          mutated = true;
        }),
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(mutated).toBe(false);
  });
});
