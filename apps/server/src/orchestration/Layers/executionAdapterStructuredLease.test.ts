import { ThreadId } from "@agent-group/contracts";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { makeExecutionAdapterAuthority } from "./ExecutionAdapterAuthority";
import { withStructuredRuntimeLease } from "./executionAdapterStructuredLease";

const threadId = ThreadId.makeUnsafe("structured-event-lease");

describe("withStructuredRuntimeLease", () => {
  it("drops a late structured event after terminal ownership begins", async () => {
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
        runtimeInstanceId: "runtime-terminal",
        providerSessionId: null,
        startedAt: "2026-07-26T00:00:00.000Z",
      }),
    );
    let mutated = false;

    await Effect.runPromise(
      withStructuredRuntimeLease({
        authority,
        threadId,
        operation: "late-event",
        effect: Effect.sync(() => {
          mutated = true;
        }),
      }),
    );

    expect(mutated).toBe(false);
  });

  it("holds structured authority until the event side effect settles", async () => {
    const authority = await Effect.runPromise(
      makeExecutionAdapterAuthority({
        persist: () => Effect.void,
        now: () => new Date("2026-07-26T00:00:00.000Z"),
      }),
    );
    await Effect.runPromise(
      withStructuredRuntimeLease({
        authority,
        threadId,
        operation: "runtime-event",
        effect: Effect.gen(function* () {
          expect(
            Exit.isFailure(
              yield* Effect.exit(
                authority.beginTerminalSwitch({
                  threadId,
                  provider: "codex",
                  runtimeInstanceId: "runtime-racing",
                  providerSessionId: null,
                  startedAt: "2026-07-26T00:00:00.000Z",
                }),
              ),
            ),
          ).toBe(true);
        }),
      }),
    );
  });
});
