import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Duration, Effect, FileSystem, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { realpathNearestExisting } from "./realpathNearestExisting";

it.effect("falls back when realpath never completes", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    let realPathCalls = 0;
    const stalledFileSystem: FileSystem.FileSystem = {
      ...fileSystem,
      exists: (candidate) => Effect.succeed(candidate === "/virtual/protected"),
      realPath: () =>
        Effect.sync(() => {
          realPathCalls += 1;
        }).pipe(Effect.andThen(Effect.never)),
    };
    const resolving = yield* realpathNearestExisting("/virtual/protected/workspace", {
      realPathTimeoutMs: 1_000,
    }).pipe(Effect.provideService(FileSystem.FileSystem, stalledFileSystem), Effect.forkChild);

    yield* TestClock.adjust(Duration.seconds(1));

    expect(yield* Fiber.join(resolving)).toBe("/virtual/protected/workspace");
    expect(realPathCalls).toBe(1);
  }).pipe(Effect.provide(NodeServices.layer)),
);
