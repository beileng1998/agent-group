import { ThreadId } from "@agent-group/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";

import { makeTerminalAgentOperationLocks } from "./terminalAgentOperationLocks";
import { runTerminalAgentLaunchTransaction } from "./terminalAgentLaunchTransaction";

const threadId = ThreadId.makeUnsafe("terminal-launch-transaction");

describe("runTerminalAgentLaunchTransaction", () => {
  it.effect("keeps the per-Thread lock until an interrupted physical launch settles", () =>
    Effect.gen(function* () {
      const locks = yield* makeTerminalAgentOperationLocks;
      const entered = yield* Deferred.make<void>();
      const secondEntered = yield* Deferred.make<void>();
      let resolveLaunch: (() => void) | undefined;

      const first = yield* locks
        .withThread(
          threadId,
          runTerminalAgentLaunchTransaction(
            () =>
              new Promise<void>((resolve) => {
                resolveLaunch = resolve;
                Effect.runSync(Deferred.succeed(entered, undefined));
              }),
            (cause) => cause,
          ),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(entered);

      const interrupted = yield* Fiber.interrupt(first).pipe(Effect.forkChild);
      const second = yield* locks
        .withThread(threadId, Deferred.succeed(secondEntered, undefined))
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      assert.equal(interrupted.pollUnsafe(), undefined);
      assert.equal(second.pollUnsafe(), undefined);

      resolveLaunch?.();
      yield* Fiber.join(interrupted);
      yield* Deferred.await(secondEntered);
      yield* Fiber.join(second);
    }),
  );
});
