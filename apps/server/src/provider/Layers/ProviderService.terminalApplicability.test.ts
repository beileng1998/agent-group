import {
  EventId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
} from "@agent-group/contracts";
import { assert } from "@effect/vitest";
import { Effect, Fiber, Option, Stream } from "effect";

import { ProviderService } from "../Services/ProviderService.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "../Services/ProviderSessionDirectory.ts";
import {
  makeProviderServiceLayer,
  sleep,
  type LegacyProviderRuntimeEvent,
  waitUntilEffect,
} from "./ProviderService.testSupport.ts";

const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

function runtimePayload(binding: ProviderRuntimeBinding | undefined): Record<string, unknown> {
  const payload = binding?.runtimePayload;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

const observeNextEvent = (stream: Stream.Stream<ProviderRuntimeEvent>) =>
  Stream.runHead(stream).pipe(Effect.forkChild);

const applicability = makeProviderServiceLayer();

applicability.layer("ProviderService terminal turn applicability", (it) => {
  it.effect("publishes a stale terminal event without clearing the active turn", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-stale-terminal");
      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });
      const activeTurn = yield* provider.sendTurn({ threadId, input: "active" });

      const observed = yield* observeNextEvent(provider.streamEvents);
      yield* Effect.yieldNow;
      applicability.codex.emit({
        type: "turn.completed",
        eventId: asEventId("event-stale-terminal"),
        provider: "codex",
        createdAt: new Date().toISOString(),
        threadId,
        turnId: asTurnId("turn-old"),
        payload: { state: "completed" },
      });
      const published = Option.getOrUndefined(yield* Fiber.join(observed));

      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      assert.equal(runtimePayload(binding).activeTurnId, activeTurn.turnId);
      assert.equal(binding?.status, "running");
      assert.equal(published?.eventId, asEventId("event-stale-terminal"));
    }),
  );

  it.effect("does not let a conflicting started event replace the active turn", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-conflicting-start");
      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });
      const activeTurn = yield* provider.sendTurn({ threadId, input: "active" });

      const observed = yield* observeNextEvent(provider.streamEvents);
      yield* Effect.yieldNow;
      applicability.codex.emit({
        type: "turn.started",
        eventId: asEventId("event-conflicting-start"),
        provider: "codex",
        createdAt: new Date().toISOString(),
        threadId,
        turnId: asTurnId("turn-conflict"),
      });
      yield* Fiber.join(observed);

      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      assert.equal(runtimePayload(binding).activeTurnId, activeTurn.turnId);
      assert.equal(binding?.status, "running");
    }),
  );

  it.effect("keeps matching and unscoped terminal compatibility", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const matchingThreadId = asThreadId("thread-matching-terminal");
      yield* provider.startSession(matchingThreadId, {
        provider: "codex",
        threadId: matchingThreadId,
        runtimeMode: "full-access",
      });
      const matchingTurn = yield* provider.sendTurn({
        threadId: matchingThreadId,
        input: "matching",
      });

      let observed = yield* observeNextEvent(provider.streamEvents);
      yield* Effect.yieldNow;
      applicability.codex.emit({
        type: "turn.completed",
        eventId: asEventId("event-matching-terminal"),
        provider: "codex",
        createdAt: new Date().toISOString(),
        threadId: matchingThreadId,
        turnId: matchingTurn.turnId,
        payload: { state: "completed" },
      });
      yield* Fiber.join(observed);

      let binding = Option.getOrUndefined(yield* directory.getBinding(matchingThreadId));
      assert.equal(runtimePayload(binding).activeTurnId, null);
      assert.equal(binding?.status, "stopped");

      const unscopedThreadId = asThreadId("thread-unscoped-terminal");
      yield* provider.startSession(unscopedThreadId, {
        provider: "codex",
        threadId: unscopedThreadId,
        runtimeMode: "full-access",
      });
      yield* provider.sendTurn({ threadId: unscopedThreadId, input: "unscoped" });

      observed = yield* observeNextEvent(provider.streamEvents);
      yield* Effect.yieldNow;
      applicability.codex.emit({
        type: "turn.completed",
        eventId: asEventId("event-unscoped-terminal"),
        provider: "codex",
        createdAt: new Date().toISOString(),
        threadId: unscopedThreadId,
        payload: { state: "completed" },
      });
      yield* Fiber.join(observed);

      binding = Option.getOrUndefined(yield* directory.getBinding(unscopedThreadId));
      assert.equal(runtimePayload(binding).activeTurnId, null);
      assert.equal(binding?.status, "stopped");
    }),
  );

  it.effect("does not resurrect a turn that settles unscoped before send returns", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-unscoped-pre-write-terminal");
      const turnId = asTurnId("turn-unscoped-pre-write-terminal");
      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });
      applicability.codex.sendTurn.mockImplementationOnce((input: ProviderSendTurnInput) =>
        Effect.gen(function* () {
          applicability.codex.emit({
            type: "turn.started",
            eventId: asEventId("event-unscoped-pre-write-started"),
            provider: "codex",
            createdAt: new Date().toISOString(),
            threadId: input.threadId,
            turnId,
          });
          yield* waitUntilEffect(() =>
            directory.getBinding(input.threadId).pipe(
              Effect.map((binding) =>
                Option.match(binding, {
                  onNone: () => false,
                  onSome: (value) => runtimePayload(value).activeTurnId === turnId,
                }),
              ),
              Effect.orDie,
            ),
          );
          applicability.codex.emit({
            type: "turn.completed",
            eventId: asEventId("event-unscoped-pre-write-terminal"),
            provider: "codex",
            createdAt: new Date().toISOString(),
            threadId: input.threadId,
            payload: { state: "completed" },
          });
          yield* waitUntilEffect(() =>
            directory.getBinding(input.threadId).pipe(
              Effect.map((binding) =>
                Option.match(binding, {
                  onNone: () => false,
                  onSome: (value) => runtimePayload(value).lastRuntimeEvent === "turn.completed",
                }),
              ),
              Effect.orDie,
            ),
          );
          return { threadId: input.threadId, turnId };
        }),
      );

      yield* provider.sendTurn({ threadId, input: "settle before return" });

      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      assert.equal(runtimePayload(binding).activeTurnId, null);
      assert.equal(binding?.status, "stopped");
    }),
  );
});

const staleIdle = makeProviderServiceLayer({ runtimeIdleStopMs: 40 });

staleIdle.layer("ProviderService stale terminal idle guard", (it) => {
  it.effect("does not schedule idle stop for a stale terminal event", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-stale-terminal-idle");
      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });
      const activeTurn = yield* provider.sendTurn({ threadId, input: "active" });
      staleIdle.codex.stopSession.mockClear();

      const observed = yield* observeNextEvent(provider.streamEvents);
      yield* Effect.yieldNow;
      const event: LegacyProviderRuntimeEvent = {
        type: "turn.aborted",
        eventId: asEventId("event-stale-terminal-idle"),
        provider: "codex",
        createdAt: new Date().toISOString(),
        threadId,
        turnId: asTurnId("turn-old"),
        payload: { reason: "stale" },
      };
      staleIdle.codex.emit(event);
      yield* Fiber.join(observed);
      yield* sleep(80);

      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      assert.equal(staleIdle.codex.stopSession.mock.calls.length, 0);
      assert.equal(yield* staleIdle.codex.hasSession(threadId), true);
      assert.equal(runtimePayload(binding).activeTurnId, activeTurn.turnId);
    }),
  );
});
