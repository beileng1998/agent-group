import { EventId, ProviderSessionStartInput, ThreadId } from "@agent-group/contracts";
import { assert } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Option, Stream } from "effect";

import { ProviderService } from "../Services/ProviderService.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { makeProviderServiceLayer, sleep } from "./ProviderService.testSupport.ts";

const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const lifecycle = makeProviderServiceLayer();

lifecycle.layer("ProviderService lifecycle serialization", (it) => {
  it.effect("finishes a queued stop after a blocked start without leaving a binding", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-start-then-stop");
      const startEntered = yield* Deferred.make<void>();
      const releaseStart = yield* Deferred.make<void>();
      const defaultStart = lifecycle.codex.startSession.getMockImplementation();
      if (!defaultStart) {
        assert.fail("Expected a default startSession implementation");
      }
      lifecycle.codex.startSession.mockImplementationOnce((input: ProviderSessionStartInput) =>
        Deferred.succeed(startEntered, undefined).pipe(
          Effect.andThen(Deferred.await(releaseStart)),
          Effect.andThen(defaultStart(input)),
        ),
      );

      const start = yield* provider
        .startSession(threadId, {
          provider: "codex",
          threadId,
          runtimeMode: "full-access",
        })
        .pipe(Effect.forkChild);
      yield* Deferred.await(startEntered);
      const stop = yield* provider.stopSession({ threadId }).pipe(Effect.forkChild);

      yield* Deferred.succeed(releaseStart, undefined);
      yield* Fiber.join(start);
      yield* Fiber.join(stop);

      assert.equal(Option.isNone(yield* directory.getBinding(threadId)), true);
      assert.equal(yield* lifecycle.codex.hasSession(threadId), false);
    }),
  );

  it.effect("starts a fresh session after a blocked stop finishes", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-stop-then-start");
      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });

      const stopEntered = yield* Deferred.make<void>();
      const releaseStop = yield* Deferred.make<void>();
      const defaultStop = lifecycle.codex.stopSession.getMockImplementation();
      if (!defaultStop) {
        assert.fail("Expected a default stopSession implementation");
      }
      lifecycle.codex.stopSession.mockImplementationOnce((input: ThreadId) =>
        Deferred.succeed(stopEntered, undefined).pipe(
          Effect.andThen(Deferred.await(releaseStop)),
          Effect.andThen(defaultStop(input)),
        ),
      );

      const stop = yield* provider.stopSession({ threadId }).pipe(Effect.forkChild);
      yield* Deferred.await(stopEntered);
      const start = yield* provider
        .startSession(threadId, {
          provider: "codex",
          threadId,
          runtimeMode: "full-access",
        })
        .pipe(Effect.forkChild);

      yield* Deferred.succeed(releaseStop, undefined);
      yield* Fiber.join(stop);
      yield* Fiber.join(start);

      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      assert.equal(binding?.provider, "codex");
      assert.equal(yield* lifecycle.codex.hasSession(threadId), true);
    }),
  );

  it.effect("does not recover work that arrives while an explicit stop is proving exit", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-work-during-stop");
      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });

      const stopEntered = yield* Deferred.make<void>();
      const releaseStop = yield* Deferred.make<void>();
      const defaultStop = lifecycle.codex.stopSession.getMockImplementation();
      if (!defaultStop) {
        assert.fail("Expected a default stopSession implementation");
      }
      lifecycle.codex.startSession.mockClear();
      lifecycle.codex.stopSession.mockImplementationOnce((input: ThreadId) =>
        defaultStop(input).pipe(
          Effect.andThen(Deferred.succeed(stopEntered, undefined)),
          Effect.andThen(Deferred.await(releaseStop)),
        ),
      );

      const stop = yield* provider.stopSession({ threadId }).pipe(Effect.forkChild);
      yield* Deferred.await(stopEntered);
      const send = yield* provider
        .sendTurn({ threadId, input: "must not restart" })
        .pipe(Effect.forkChild);

      yield* Deferred.succeed(releaseStop, undefined);
      yield* Fiber.join(stop);
      const sendExit = yield* Fiber.await(send);

      assert.equal(Exit.isFailure(sendExit), true);
      assert.equal(lifecycle.codex.startSession.mock.calls.length, 0);
      assert.equal(Option.isNone(yield* directory.getBinding(threadId)), true);
      assert.equal(yield* lifecycle.codex.hasSession(threadId), false);
    }),
  );

  it.effect("coalesces concurrent recovery into one provider start", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-concurrent-recovery");
      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });
      yield* lifecycle.codex.stopSession(threadId);

      const recoveryEntered = yield* Deferred.make<void>();
      const releaseRecovery = yield* Deferred.make<void>();
      const defaultStart = lifecycle.codex.startSession.getMockImplementation();
      if (!defaultStart) {
        assert.fail("Expected a default startSession implementation");
      }
      lifecycle.codex.startSession.mockClear();
      lifecycle.codex.startSession.mockImplementationOnce((input: ProviderSessionStartInput) =>
        Deferred.succeed(recoveryEntered, undefined).pipe(
          Effect.andThen(Deferred.await(releaseRecovery)),
          Effect.andThen(defaultStart(input)),
        ),
      );

      const first = yield* provider.sendTurn({ threadId, input: "first" }).pipe(Effect.forkChild);
      yield* Deferred.await(recoveryEntered);
      const second = yield* provider.sendTurn({ threadId, input: "second" }).pipe(Effect.forkChild);

      yield* Deferred.succeed(releaseRecovery, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);

      assert.equal(lifecycle.codex.startSession.mock.calls.length, 1);
    }),
  );

  it.effect("keeps a queued cursor clear authoritative over recovery", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const directory = yield* ProviderSessionDirectory;
      const threadId = asThreadId("thread-recovery-then-clear");
      yield* provider.startSession(threadId, {
        provider: "codex",
        threadId,
        runtimeMode: "full-access",
      });
      yield* lifecycle.codex.stopSession(threadId);

      const recoveryEntered = yield* Deferred.make<void>();
      const releaseRecovery = yield* Deferred.make<void>();
      const defaultStart = lifecycle.codex.startSession.getMockImplementation();
      if (!defaultStart) {
        assert.fail("Expected a default startSession implementation");
      }
      lifecycle.codex.startSession.mockImplementationOnce((input: ProviderSessionStartInput) =>
        Deferred.succeed(recoveryEntered, undefined).pipe(
          Effect.andThen(Deferred.await(releaseRecovery)),
          Effect.andThen(defaultStart(input)),
        ),
      );

      const recovery = yield* provider
        .sendTurn({ threadId, input: "recover" })
        .pipe(Effect.forkChild);
      yield* Deferred.await(recoveryEntered);
      if (!provider.clearSessionResumeCursor) {
        assert.fail("Expected clearSessionResumeCursor to be available");
      }
      const clear = yield* provider.clearSessionResumeCursor({ threadId }).pipe(Effect.forkChild);

      yield* Deferred.succeed(releaseRecovery, undefined);
      yield* Fiber.join(recovery);
      yield* Fiber.join(clear);

      const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
      assert.equal(binding?.resumeCursor, null);
      assert.equal(yield* lifecycle.codex.hasSession(threadId), false);
    }),
  );
});

const queuedIdle = makeProviderServiceLayer({ runtimeIdleStopMs: 40 });

queuedIdle.layer("ProviderService queued lifecycle idle invalidation", (it) => {
  it.effect("invalidates an idle timer created after a lifecycle operation queued", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService;
      const threadId = asThreadId("thread-queued-idle-start");
      const firstEntered = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const secondEntered = yield* Deferred.make<void>();
      const releaseSecond = yield* Deferred.make<void>();
      const runtimeEventSeen = yield* Deferred.make<void>();
      const defaultStart = queuedIdle.codex.startSession.getMockImplementation();
      if (!defaultStart) {
        assert.fail("Expected a default startSession implementation");
      }
      queuedIdle.codex.startSession
        .mockImplementationOnce((input: ProviderSessionStartInput) =>
          Deferred.succeed(firstEntered, undefined).pipe(
            Effect.andThen(Deferred.await(releaseFirst)),
            Effect.andThen(defaultStart(input)),
          ),
        )
        .mockImplementationOnce((input: ProviderSessionStartInput) =>
          Deferred.succeed(secondEntered, undefined).pipe(
            Effect.andThen(Deferred.await(releaseSecond)),
            Effect.andThen(defaultStart(input)),
          ),
        );
      queuedIdle.codex.stopSession.mockClear();
      const runtimeEvents = yield* Stream.runForEach(provider.streamEvents, (event) =>
        event.eventId === EventId.makeUnsafe("event-queued-idle")
          ? Deferred.succeed(runtimeEventSeen, undefined).pipe(Effect.asVoid)
          : Effect.void,
      ).pipe(Effect.forkChild);

      const first = yield* provider
        .startSession(threadId, {
          provider: "codex",
          threadId,
          runtimeMode: "full-access",
        })
        .pipe(Effect.forkChild);
      yield* Deferred.await(firstEntered);
      const second = yield* provider
        .startSession(threadId, {
          provider: "codex",
          threadId,
          runtimeMode: "full-access",
        })
        .pipe(Effect.forkChild);
      yield* sleep(10);

      queuedIdle.codex.emit({
        type: "session.started",
        eventId: EventId.makeUnsafe("event-queued-idle"),
        provider: "codex",
        createdAt: new Date().toISOString(),
        threadId,
      });
      yield* Deferred.await(runtimeEventSeen);
      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Fiber.join(first);
      yield* Deferred.await(secondEntered);

      yield* sleep(80);
      yield* Deferred.succeed(releaseSecond, undefined);
      yield* Fiber.join(second);
      yield* sleep(50);
      yield* Fiber.interrupt(runtimeEvents);

      assert.equal(queuedIdle.codex.stopSession.mock.calls.length, 0);
      assert.equal(yield* queuedIdle.codex.hasSession(threadId), true);
    }),
  );
});
