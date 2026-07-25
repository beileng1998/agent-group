import {
  CommandId,
  EventId,
  MessageId,
  type OrchestrationEvent,
  type OrchestrationThread,
  ThreadId,
  TurnId,
} from "@agent-group/contracts";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import type { ExecutionAdapterAuthorityError } from "../Services/ExecutionAdapterAuthority.ts";
import { makeExecutionAdapterAuthority } from "./ExecutionAdapterAuthority.ts";
import { makeProviderTurnAdmission } from "./providerTurnAdmission.ts";
import { ProviderTurnQueue } from "./providerTurnQueue.ts";
import {
  makeProviderTurnQueueDrain,
  withCanceledProviderTurnClaimCleanup,
} from "./providerTurnQueueLifecycle.ts";

const threadId = ThreadId.makeUnsafe("thread-queued-claim");
const messageId = MessageId.makeUnsafe("message-queued-claim");
const now = "2026-07-26T00:00:00.000Z";

type QueuedEvent = Extract<OrchestrationEvent, { type: "thread.turn-queued" }>;
type StartEvent = Extract<
  OrchestrationEvent,
  { type: "thread.turn-start-requested" }
>;

function eventBase(commandId: CommandId) {
  return {
    sequence: 1,
    eventId: EventId.makeUnsafe(`event:${commandId}`),
    aggregateKind: "thread" as const,
    aggregateId: threadId,
    occurredAt: now,
    commandId,
    causationEventId: null,
    correlationId: commandId,
    metadata: {},
  };
}

function queuedEvent(commandId: CommandId, targetMessageId = messageId): QueuedEvent {
  return {
    ...eventBase(commandId),
    type: "thread.turn-queued",
    payload: {
      threadId,
      messageId: targetMessageId,
      dispatchMode: "queue",
      runtimeMode: "approval-required",
      interactionMode: "default",
      createdAt: now,
    },
  };
}

function startEvent(commandId: CommandId, targetMessageId = messageId): StartEvent {
  return {
    ...eventBase(commandId),
    type: "thread.turn-start-requested",
    payload: queuedEvent(commandId, targetMessageId).payload,
  };
}

async function makeHarness() {
  let currentTime = new Date(now).getTime();
  const authority = await Effect.runPromise(
    makeExecutionAdapterAuthority({
      persist: () => Effect.void,
      now: () => new Date(currentTime),
    }),
  );
  const turnQueue = new ProviderTurnQueue();
  let liveTurn = true;
  let promotionFails = false;
  let promotedCommandId: CommandId | null = null;
  const providerService = {
    listSessions: () =>
      Effect.succeed(
        liveTurn
          ? [
              {
                threadId,
                provider: "codex" as const,
                status: "running" as const,
                runtimeMode: "approval-required" as const,
                activeTurnId: TurnId.makeUnsafe("turn-active"),
                createdAt: now,
                updatedAt: now,
              },
            ]
          : [],
      ),
  } as ProviderServiceShape;
  const thread = {
    id: threadId,
    branch: null,
    worktreePath: null,
    modelSelection: { provider: "codex", model: "gpt-5-codex" },
    session: null,
    messages: [
      {
        id: messageId,
        role: "user",
        text: "queued work",
        attachments: [],
      },
    ],
  } as unknown as OrchestrationThread;
  const drainer = makeProviderTurnQueueDrain({
    turnQueue,
    releaseStructured: authority.releaseStructured,
    serverCommandId: () => CommandId.makeUnsafe("promoted-command"),
    orchestrationEngine: {
      dispatch: (command) =>
        promotionFails
          ? Effect.fail(new Error("promotion failed")).pipe(Effect.orDie)
          : Effect.gen(function* () {
              promotedCommandId = command.commandId;
              yield* authority.reserveStructuredStart(
                command.threadId,
                `command:${command.commandId}`,
              );
              return { sequence: 2 };
            }).pipe(Effect.orDie),
    },
  });
  const appendProviderFailureActivity = vi.fn(() => Effect.void);
  const admission = makeProviderTurnAdmission({
    providerService,
    turnQueue,
    claimStructuredStart: authority.claimStructuredStart,
    resolveThread: () => Effect.succeed(thread),
    hasHandledTurnStartRecently: () => Effect.succeed(false),
    appendProviderFailureActivity,
    setThreadSession: () => Effect.void,
    setThreadSessionError: () => Effect.void,
    maybeGenerateAndRenameWorktreeBranchForFirstTurn: () => Effect.void,
    maybeGenerateAndRenameThreadTitleForFirstTurn: () => Effect.void,
    dispatchTurnForThread: () => Effect.void,
    interruptProviderTurn: () => Effect.void,
    drainQueuedTurnsForThread: drainer,
  });
  return {
    admission,
    appendProviderFailureActivity,
    authority,
    drainer,
    promotedCommandId: () => promotedCommandId,
    setLiveTurn: (value: boolean) => {
      liveTurn = value;
    },
    setPromotionFails: (value: boolean) => {
      promotionFails = value;
    },
    advanceTime: (milliseconds: number) => {
      currentTime += milliseconds;
    },
    turnQueue,
  };
}

async function expectSwitchBlocked(
  authority: Awaited<ReturnType<typeof makeHarness>>["authority"],
) {
  const exit = await Effect.runPromiseExit(
    authority.beginTerminalSwitch({
      threadId,
      provider: "codex",
      runtimeInstanceId: "runtime-blocked",
      providerSessionId: null,
      startedAt: now,
    }),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    const failure = Cause.findErrorOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag === "Some") {
      expect((failure.value as ExecutionAdapterAuthorityError).reason).toBe(
        "structured-operation-active",
      );
    }
  }
}

async function expectSwitchAllowed(
  authority: Awaited<ReturnType<typeof makeHarness>>["authority"],
) {
  const state = await Effect.runPromise(
    authority.beginTerminalSwitch({
      threadId,
      provider: "codex",
      runtimeInstanceId: "runtime-allowed",
      providerSessionId: null,
      startedAt: now,
    }),
  );
  expect(state.adapter).toBe("terminal");
}

describe("queued turn authority claims", () => {
  it("keeps a queued claim leased beyond the reservation TTL", async () => {
    const harness = await makeHarness();
    const commandId = CommandId.makeUnsafe("queued-long-running-command");
    await Effect.runPromise(
      harness.authority.reserveStructuredStart(
        threadId,
        `command:${commandId}`,
      ),
    );
    await Effect.runPromise(harness.admission.processTurnQueued(queuedEvent(commandId)));

    harness.advanceTime(6 * 60 * 1_000);
    await expectSwitchBlocked(harness.authority);
  });

  it("requeues promotion failures without releasing the queue-owned claim", async () => {
    const harness = await makeHarness();
    const commandId = CommandId.makeUnsafe("queued-promotion-retry");
    await Effect.runPromise(
      harness.authority.reserveStructuredStart(
        threadId,
        `command:${commandId}`,
      ),
    );
    await Effect.runPromise(harness.admission.processTurnQueued(queuedEvent(commandId)));
    harness.setLiveTurn(false);
    harness.setPromotionFails(true);

    expect(Exit.isFailure(await Effect.runPromiseExit(harness.drainer(threadId)))).toBe(true);
    expect(harness.turnQueue.has(threadId, messageId)).toBe(true);
    await expectSwitchBlocked(harness.authority);

    harness.setPromotionFails(false);
    await Effect.runPromise(harness.drainer(threadId));
    expect(harness.turnQueue.has(threadId, messageId)).toBe(false);
    await expectSwitchBlocked(harness.authority);
  });

  it("transfers a queued command claim through promotion and releases it after start", async () => {
    const harness = await makeHarness();
    const originalCommandId = CommandId.makeUnsafe("queued-command");
    await Effect.runPromise(
      harness.authority.reserveStructuredStart(
        threadId,
        `command:${originalCommandId}`,
      ),
    );
    await Effect.runPromise(harness.admission.processTurnQueued(queuedEvent(originalCommandId)));

    await expectSwitchBlocked(harness.authority);
    harness.setLiveTurn(false);
    await Effect.runPromise(harness.drainer(threadId));
    await expectSwitchBlocked(harness.authority);

    const promotedCommandId = harness.promotedCommandId();
    expect(promotedCommandId).not.toBeNull();
    await Effect.runPromise(
      Effect.scoped(
        harness.admission.processTurnStartRequested(startEvent(promotedCommandId!)),
      ),
    );

    await expectSwitchAllowed(harness.authority);
    expect(harness.appendProviderFailureActivity).not.toHaveBeenCalled();
  });

  it("releases a removed queued turn claim without waiting for TTL", async () => {
    const harness = await makeHarness();
    const commandId = CommandId.makeUnsafe("canceled-command");
    await Effect.runPromise(
      harness.authority.reserveStructuredStart(threadId, `command:${commandId}`),
    );
    await Effect.runPromise(harness.admission.processTurnQueued(queuedEvent(commandId)));

    await Effect.runPromise(
      withCanceledProviderTurnClaimCleanup(
        Effect.sync(() => harness.turnQueue.remove(threadId, messageId)),
        {
          turnQueue: harness.turnQueue,
          releaseStructured: harness.authority.releaseStructured,
        },
      ),
    );

    await expectSwitchAllowed(harness.authority);
  });

  it("releases every queued claim when session stop clears the thread", async () => {
    const harness = await makeHarness();
    for (const suffix of ["one", "two"]) {
      const commandId = CommandId.makeUnsafe(`stopped-command-${suffix}`);
      const targetMessageId = MessageId.makeUnsafe(`stopped-message-${suffix}`);
      await Effect.runPromise(
        harness.authority.reserveStructuredStart(threadId, `command:${commandId}`),
      );
      await Effect.runPromise(
        harness.admission.processTurnQueued(queuedEvent(commandId, targetMessageId)),
      );
    }

    await Effect.runPromiseExit(
      withCanceledProviderTurnClaimCleanup(
        Effect.sync(() => harness.turnQueue.clearThread(threadId)).pipe(
          Effect.andThen(Effect.fail(new Error("provider stop failed"))),
        ),
        {
          turnQueue: harness.turnQueue,
          releaseStructured: harness.authority.releaseStructured,
        },
      ),
    );

    await expectSwitchAllowed(harness.authority);
  });
});
