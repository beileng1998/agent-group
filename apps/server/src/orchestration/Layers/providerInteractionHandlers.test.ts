import {
  ThreadId,
  TurnId,
  type OrchestrationSession,
  type OrchestrationThread,
} from "@agent-group/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import { makeProviderInteractionHandlers } from "./providerInteractionHandlers.ts";
import { ProviderTurnBootstrapState } from "./providerTurnBootstrapState.ts";
import { ProviderTurnQueue } from "./providerTurnQueue.ts";

const THREAD_ID = ThreadId.makeUnsafe("thread-control-timeout");
const TURN_ID = TurnId.makeUnsafe("turn-control-timeout");

function activeThread(): OrchestrationThread {
  return {
    id: THREAD_ID,
    modelSelection: { provider: "codex", model: "gpt-5" },
    session: {
      threadId: THREAD_ID,
      status: "running",
      providerName: "codex",
      runtimeMode: "full-access",
      activeTurnId: TURN_ID,
      lastError: null,
      updatedAt: "2026-08-15T08:00:00.000Z",
    },
  } as OrchestrationThread;
}

describe("provider interaction control bounds", () => {
  it("stops and settles an owning session after interrupt timeout", async () => {
    const thread = activeThread();
    const failures: Array<{ kind: string; detail: string }> = [];
    const sessions: OrchestrationSession[] = [];
    let stopCalls = 0;
    const providerService = {
      interruptTurn: () => Effect.never,
      stopSession: () =>
        Effect.sync(() => {
          stopCalls += 1;
        }),
    } as unknown as ProviderServiceShape;
    const handlers = makeProviderInteractionHandlers({
      providerService,
      bootstrapState: new ProviderTurnBootstrapState(),
      turnQueue: new ProviderTurnQueue(),
      resolveThread: () => Effect.succeed(thread),
      resolveProviderSessionThread: () => Effect.succeed(thread),
      resolveSubagentProviderThreadId: () => undefined,
      appendProviderFailureActivity: (input) =>
        Effect.sync(() => void failures.push({ kind: input.kind, detail: input.detail })),
      setThreadSession: (input) => Effect.sync(() => void sessions.push(input.session)),
      stopCurrentAdapter: (_threadId, stopStructured) =>
        stopStructured().pipe(Effect.as("structured" as const)),
      releaseCanceledClaims: () => Effect.void,
      providerInterruptTimeoutMs: 5,
      providerStopTimeoutMs: 20,
    });

    await Effect.runPromise(
      handlers.interruptProviderTurn({
        threadId: THREAD_ID,
        turnId: TURN_ID,
        createdAt: "2026-08-15T08:00:01.000Z",
      }),
    );

    expect(stopCalls).toBe(1);
    expect(failures).toEqual([
      expect.objectContaining({
        kind: "provider.turn.interrupt.failed",
        detail: expect.stringContaining("did not respond within 5ms"),
      }),
    ]);
    expect(sessions.at(-1)).toMatchObject({ status: "interrupted", activeTurnId: null });
  });

  it("settles locally when no provider session remains", async () => {
    const thread = activeThread();
    const sessions: OrchestrationSession[] = [];
    const handlers = makeProviderInteractionHandlers({
      providerService: {} as ProviderServiceShape,
      bootstrapState: new ProviderTurnBootstrapState(),
      turnQueue: new ProviderTurnQueue(),
      resolveThread: () => Effect.succeed(thread),
      resolveProviderSessionThread: () => Effect.succeed(null),
      resolveSubagentProviderThreadId: () => undefined,
      appendProviderFailureActivity: () => Effect.void,
      setThreadSession: (input) => Effect.sync(() => void sessions.push(input.session)),
      stopCurrentAdapter: () => Effect.succeed("structured" as const),
      releaseCanceledClaims: () => Effect.void,
    });

    await Effect.runPromise(
      handlers.interruptProviderTurn({
        threadId: THREAD_ID,
        turnId: TURN_ID,
        createdAt: "2026-08-15T08:00:01.000Z",
      }),
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ status: "interrupted", activeTurnId: null });
  });

  it("settles a timed-out subagent without stopping its parent session", async () => {
    const thread = activeThread();
    const parentThreadId = ThreadId.makeUnsafe("thread-parent");
    const parent = {
      ...activeThread(),
      id: parentThreadId,
      session: { ...activeThread().session, threadId: parentThreadId },
    } as OrchestrationThread;
    const sessions: OrchestrationSession[] = [];
    let stopCalls = 0;
    const handlers = makeProviderInteractionHandlers({
      providerService: {
        interruptTurn: () => Effect.never,
        stopSession: () =>
          Effect.sync(() => {
            stopCalls += 1;
          }),
      } as unknown as ProviderServiceShape,
      bootstrapState: new ProviderTurnBootstrapState(),
      turnQueue: new ProviderTurnQueue(),
      resolveThread: () => Effect.succeed(thread),
      resolveProviderSessionThread: () => Effect.succeed(parent),
      resolveSubagentProviderThreadId: () => "provider-child",
      appendProviderFailureActivity: () => Effect.void,
      setThreadSession: (input) => Effect.sync(() => void sessions.push(input.session)),
      stopCurrentAdapter: () => Effect.succeed("structured" as const),
      releaseCanceledClaims: () => Effect.void,
      providerInterruptTimeoutMs: 5,
    });

    await Effect.runPromise(
      handlers.interruptProviderTurn({
        threadId: THREAD_ID,
        turnId: TURN_ID,
        createdAt: "2026-08-15T08:00:01.000Z",
      }),
    );

    expect(stopCalls).toBe(0);
    expect(sessions.at(-1)).toMatchObject({ status: "interrupted", activeTurnId: null });
  });
});
