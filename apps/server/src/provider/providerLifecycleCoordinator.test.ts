import { ThreadId } from "@agent-group/contracts";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Ref } from "effect";
import { expect } from "vitest";

import { makeProviderLifecycleCoordinator } from "./providerLifecycleCoordinator.ts";

const threadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

it.effect("serializes lifecycle mutations for the same thread", () =>
  Effect.gen(function* () {
    const coordinator = makeProviderLifecycleCoordinator();
    const firstEntered = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const order = yield* Ref.make<string[]>([]);

    const first = yield* coordinator
      .run(threadId("thread-1"), () =>
        Effect.gen(function* () {
          yield* Ref.update(order, (entries) => [...entries, "first:start"]);
          yield* Deferred.succeed(firstEntered, undefined);
          yield* Deferred.await(releaseFirst);
          yield* Ref.update(order, (entries) => [...entries, "first:end"]);
        }),
      )
      .pipe(Effect.forkChild);

    yield* Deferred.await(firstEntered);
    const second = yield* coordinator
      .run(threadId("thread-1"), () => Ref.update(order, (entries) => [...entries, "second"]))
      .pipe(Effect.forkChild);
    yield* Effect.yieldNow;

    expect(yield* Ref.get(order)).toEqual(["first:start"]);
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
    expect(yield* Ref.get(order)).toEqual(["first:start", "first:end", "second"]);
  }),
);

it.effect("allows independent threads to progress concurrently", () =>
  Effect.gen(function* () {
    const coordinator = makeProviderLifecycleCoordinator();
    const firstEntered = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();

    const first = yield* coordinator
      .run(threadId("thread-1"), () =>
        Deferred.succeed(firstEntered, undefined).pipe(
          Effect.andThen(Deferred.await(releaseFirst)),
        ),
      )
      .pipe(Effect.forkChild);

    yield* Deferred.await(firstEntered);
    const secondResult = yield* coordinator.run(threadId("thread-2"), () => Effect.succeed("done"));
    expect(secondResult).toBe("done");
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Fiber.join(first);
  }),
);

it.effect("releases the thread lock when a mutation fails", () =>
  Effect.gen(function* () {
    const coordinator = makeProviderLifecycleCoordinator();
    const target = threadId("thread-1");

    const result = yield* coordinator
      .run(target, () => Effect.fail("start failed"))
      .pipe(Effect.result);

    expect(result._tag).toBe("Failure");
    expect(yield* coordinator.run(target, () => Effect.succeed("released"))).toBe("released");
  }),
);

it.effect("releases the thread lock when a mutation is interrupted", () =>
  Effect.gen(function* () {
    const coordinator = makeProviderLifecycleCoordinator();
    const target = threadId("thread-1");
    const entered = yield* Deferred.make<void>();

    const blocked = yield* coordinator
      .run(target, () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)))
      .pipe(Effect.forkChild);
    yield* Deferred.await(entered);
    yield* Fiber.interrupt(blocked);

    expect(yield* coordinator.run(target, () => Effect.succeed("released"))).toBe("released");
  }),
);
