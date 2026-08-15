import {
  CommandId,
  EventId,
  ThreadId,
  TurnId,
  type OrchestrationThread,
} from "@agent-group/contracts";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { makeExecutionAdapterAuthority } from "./ExecutionAdapterAuthority";
import { makeProviderIntentRouter, type ProviderIntentEvent } from "./providerIntentRouter";
import { ProviderSessionSelectionState } from "./providerSessionSelectionState";

const threadId = ThreadId.makeUnsafe("thread-terminal-model-router");
const now = "2026-07-25T00:00:00.000Z";

describe("provider intent terminal model observation", () => {
  it("updates the selection cache without entering the structured adapter", async () => {
    const selectionState = new ProviderSessionSelectionState();
    let structuredAcquisitions = 0;
    const unused = () => Effect.void;
    const router = makeProviderIntentRouter({
      selectionState,
      resolveThread: () => Effect.succeed(undefined as OrchestrationThread | undefined),
      ensureSessionForThread: unused,
      acquireStructured: () => {
        structuredAcquisitions += 1;
        return Effect.die("terminal model observations must stay terminal-owned");
      },
      hasLiveProviderTurn: () => Effect.succeed(false),
      setThreadSessionError: unused,
      processTurnQueued: unused,
      processTurnStartRequested: unused,
      processTurnInterruptRequested: unused,
      processApprovalResponseRequested: unused,
      processUserInputResponseRequested: unused,
      processConversationRollbackRequested: unused,
      processMessageEditResendRequested: unused,
      processSessionStopRequested: unused,
    });
    const event: ProviderIntentEvent = {
      sequence: 2,
      eventId: EventId.makeUnsafe("event-terminal-model"),
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: now,
      commandId: CommandId.makeUnsafe("command-terminal-model"),
      causationEventId: null,
      correlationId: CommandId.makeUnsafe("command-terminal-model"),
      metadata: { adapterKey: "terminal" },
      type: "thread.meta-updated",
      payload: {
        threadId,
        modelSelection: {
          provider: "pi",
          model: "openai/gpt-5.1",
          options: { thinkingLevel: "xhigh" },
        },
        updatedAt: now,
      },
    };

    await Effect.runPromise(router(event));

    expect(structuredAcquisitions).toBe(0);
    expect(selectionState.getModelSelection(threadId)).toEqual(event.payload.modelSelection);
  });

  it("rejects queued structured side effects after terminal authority takes over", async () => {
    const authority = await Effect.runPromise(
      makeExecutionAdapterAuthority({
        persist: () => Effect.void,
        now: () => new Date(now),
      }),
    );
    const executed: string[] = [];
    const sideEffect = (name: string) => () =>
      Effect.sync(() => {
        executed.push(name);
      });
    const unused = () => Effect.void;
    const router = makeProviderIntentRouter({
      selectionState: new ProviderSessionSelectionState(),
      resolveThread: () => Effect.succeed(undefined as OrchestrationThread | undefined),
      ensureSessionForThread: unused,
      acquireStructured: authority.acquireStructured,
      hasLiveProviderTurn: () => Effect.succeed(false),
      setThreadSessionError: sideEffect("session-error"),
      processTurnQueued: unused,
      processTurnStartRequested: unused,
      processTurnInterruptRequested: sideEffect("interrupt"),
      processApprovalResponseRequested: sideEffect("approval"),
      processUserInputResponseRequested: sideEffect("user-input"),
      processConversationRollbackRequested: sideEffect("rollback"),
      processMessageEditResendRequested: sideEffect("edit-resend"),
      processSessionStopRequested: unused,
    });
    const eventTypes = [
      "thread.turn-interrupt-requested",
      "thread.approval-response-requested",
      "thread.user-input-response-requested",
      "thread.conversation-rollback-requested",
      "thread.message-edit-resend-requested",
    ] as const;
    const queued = eventTypes.map((type, index) =>
      router({
        sequence: index + 1,
        eventId: EventId.makeUnsafe(`event-delayed-${index}`),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe(`command-delayed-${index}`),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe(`command-delayed-${index}`),
        metadata: {},
        type,
        payload: { threadId },
      } as unknown as ProviderIntentEvent),
    );

    await Effect.runPromise(
      authority.beginTerminalSwitch({
        threadId,
        provider: "codex",
        runtimeInstanceId: "runtime-delayed-effects",
        providerSessionId: null,
        startedAt: now,
      }),
    );
    const exits = await Promise.all(queued.map((operation) => Effect.runPromiseExit(operation)));

    expect(exits.every(Exit.isFailure)).toBe(true);
    expect(executed).toEqual([]);
  });
});

describe("provider intent runtime mode routing", () => {
  it("defers the provider restart while a turn is active", async () => {
    const selectionState = new ProviderSessionSelectionState();
    let activeTurnId: TurnId | null = TurnId.makeUnsafe("turn-runtime-mode-active");
    const ensuredRuntimeModes: string[] = [];
    const unused = () => Effect.void;
    const router = makeProviderIntentRouter({
      selectionState,
      resolveThread: () =>
        Effect.succeed({
          id: threadId,
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          session: {
            threadId,
            status: "running",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId,
            lastError: null,
            updatedAt: now,
          },
        } as unknown as OrchestrationThread),
      ensureSessionForThread: (_threadId, _createdAt, options) =>
        Effect.sync(() => {
          if (options?.runtimeMode) ensuredRuntimeModes.push(options.runtimeMode);
        }),
      acquireStructured: (_threadId, claimId) =>
        Effect.succeed({ threadId, claimId, release: Effect.void }),
      hasLiveProviderTurn: () => Effect.succeed(false),
      setThreadSessionError: unused,
      processTurnQueued: unused,
      processTurnStartRequested: unused,
      processTurnInterruptRequested: unused,
      processApprovalResponseRequested: unused,
      processUserInputResponseRequested: unused,
      processConversationRollbackRequested: unused,
      processMessageEditResendRequested: unused,
      processSessionStopRequested: unused,
    });
    const event = (suffix: string): ProviderIntentEvent => ({
      sequence: 3,
      eventId: EventId.makeUnsafe(`event-runtime-mode-${suffix}`),
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: now,
      commandId: CommandId.makeUnsafe(`command-runtime-mode-${suffix}`),
      causationEventId: null,
      correlationId: CommandId.makeUnsafe(`command-runtime-mode-${suffix}`),
      metadata: {},
      type: "thread.runtime-mode-set",
      payload: {
        threadId,
        runtimeMode: "approval-required",
        updatedAt: now,
      },
    });

    await Effect.runPromise(router(event("active")));
    expect(ensuredRuntimeModes).toEqual([]);

    activeTurnId = null;
    await Effect.runPromise(router(event("settled")));
    expect(ensuredRuntimeModes).toEqual(["approval-required"]);
  });
});
