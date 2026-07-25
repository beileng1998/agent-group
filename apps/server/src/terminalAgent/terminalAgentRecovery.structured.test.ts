import { ThreadId } from "@agent-group/contracts";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { makeExecutionAdapterAuthority } from "../orchestration/Layers/ExecutionAdapterAuthority";
import type { ExecutionAdapterAuthorityShape } from "../orchestration/Services/ExecutionAdapterAuthority";
import { recoverStructuredAuthority } from "./terminalAgentRecovery";

const threadId = ThreadId.makeUnsafe("terminal-recovery-thread");

describe("managed terminal recovery", () => {
  it("completes an interrupted structured restoration", async () => {
    const authority = await Effect.runPromise(
      makeExecutionAdapterAuthority({
        initialStates: new Map([
          [
            threadId,
            { adapter: "structured", revision: 4, status: "restoring" },
          ],
        ]),
        persist: () => Effect.void,
        now: () => new Date("2026-07-25T00:00:00.000Z"),
      }),
    );

    await Effect.runPromise(
      recoverStructuredAuthority({
        threadId,
        state: { adapter: "structured", revision: 4, status: "restoring" },
        authority,
        threadActive: true,
      }),
    );

    expect(await Effect.runPromise(authority.getState(threadId))).toEqual({
      adapter: "structured",
      revision: 4,
      status: "ready",
    });
  });

  it("completes a structured stop interrupted by server restart", async () => {
    const completeStructuredStop = vi.fn(() =>
      Effect.succeed({
        adapter: "structured" as const,
        revision: 4,
        status: "ready" as const,
      }),
    );
    const authority = {
      completeStructuredStop,
      forgetThread: vi.fn(),
    } as unknown as ExecutionAdapterAuthorityShape;

    await Effect.runPromise(
      recoverStructuredAuthority({
        threadId,
        state: { adapter: "structured", revision: 4, status: "stopping" },
        authority,
        threadActive: true,
      }),
    );

    expect(completeStructuredStop).toHaveBeenCalledWith(threadId, 4);
  });

  it("preserves a deletion tombstone for the startup cleanup sweep", async () => {
    const authority = {
      completeStructuredStop: vi.fn(),
      completeStructuredRestore: vi.fn(),
      forgetThread: vi.fn(),
    } as unknown as ExecutionAdapterAuthorityShape;

    await Effect.runPromise(
      recoverStructuredAuthority({
        threadId,
        state: { adapter: "structured", revision: 5, status: "deleting" },
        authority,
        threadActive: false,
      }),
    );

    expect(authority.completeStructuredStop).not.toHaveBeenCalled();
    expect(authority.completeStructuredRestore).not.toHaveBeenCalled();
    expect(authority.forgetThread).not.toHaveBeenCalled();
  });

  it("tombstones structured authority for a deleted Thread", async () => {
    const authority = await Effect.runPromise(
      makeExecutionAdapterAuthority({
        initialStates: new Map([
          [
            threadId,
            { adapter: "structured", revision: 4, status: "restoring" },
          ],
        ]),
        persist: () => Effect.void,
        now: () => new Date("2026-07-25T00:00:00.000Z"),
      }),
    );

    await Effect.runPromise(
      recoverStructuredAuthority({
        threadId,
        state: { adapter: "structured", revision: 4, status: "restoring" },
        authority,
        threadActive: false,
      }),
    );

    expect(
      (await Effect.runPromise(authority.listStates)).get(threadId),
    ).toMatchObject({
      adapter: "structured",
      revision: 5,
      status: "deleting",
    });
  });
});
