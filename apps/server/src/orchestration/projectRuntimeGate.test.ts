import { Deferred, Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";

import { withProjectRuntimeGate } from "./projectRuntimeGate";

describe("project runtime gate", () => {
  it("makes a queued root mutation observe Thread creation before Terminal launch", async () => {
    const projectId = "project-runtime-race";
    const createEntered = await Effect.runPromise(Deferred.make<void>());
    const releaseCreate = await Effect.runPromise(Deferred.make<void>());
    const updateEntered = await Effect.runPromise(Deferred.make<number>());
    const releaseUpdate = await Effect.runPromise(Deferred.make<void>());
    const terminalEntered = await Effect.runPromise(Deferred.make<void>());
    const threads: string[] = [];

    const creating = Effect.runFork(
      withProjectRuntimeGate(
        projectId,
        Deferred.succeed(createEntered, undefined).pipe(
          Effect.andThen(Deferred.await(releaseCreate)),
          Effect.andThen(Effect.sync(() => threads.push("thread-new"))),
        ),
      ),
    );
    await Effect.runPromise(Deferred.await(createEntered));
    const updating = Effect.runFork(
      withProjectRuntimeGate(
        projectId,
        Effect.suspend(() =>
          Deferred.succeed(updateEntered, threads.length).pipe(
            Effect.andThen(Deferred.await(releaseUpdate)),
          ),
        ),
      ),
    );
    const launching = Effect.runFork(
      withProjectRuntimeGate(
        projectId,
        Deferred.succeed(terminalEntered, undefined),
      ),
    );

    await Effect.runPromise(Deferred.succeed(releaseCreate, undefined));
    expect(await Effect.runPromise(Deferred.await(updateEntered))).toBe(1);
    expect(await Effect.runPromise(Deferred.poll(terminalEntered))).toBeUndefined();
    await Effect.runPromise(Deferred.succeed(releaseUpdate, undefined));
    await Effect.runPromise(Deferred.await(terminalEntered));
    await Promise.all([
      Effect.runPromise(Fiber.join(creating)),
      Effect.runPromise(Fiber.join(updating)),
      Effect.runPromise(Fiber.join(launching)),
    ]);
  });
});
