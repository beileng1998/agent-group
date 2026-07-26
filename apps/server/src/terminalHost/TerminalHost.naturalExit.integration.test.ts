import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { expect } from "vitest";

import { makeNodePtyLayer } from "../terminal/Layers/NodePTY";
import { PtyAdapter } from "../terminal/Services/PTY";
import { TerminalHost } from "./TerminalHost";

const PtyTestLayer = makeNodePtyLayer().pipe(Layer.provide(NodeServices.layer));

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function pidDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

it.layer(PtyTestLayer)("TerminalHost natural exit integration", (it) => {
  it.effect("reaps a background child after the PTY root exits naturally", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return;
      const adapter = yield* PtyAdapter;
      const runtimeDir = yield* Effect.promise(() =>
        fs.mkdtemp(path.join(os.tmpdir(), "terminal-host-natural-exit-")),
      );
      const childPidPath = path.join(runtimeDir, "child.pid");
      const host = new TerminalHost({
        spawnPty: (input) => Effect.runPromise(adapter.spawn(input)),
        killGraceMs: 300,
      });
      let childPid: number | undefined;

      try {
        yield* Effect.promise(() =>
          host.createOrAttach({
            sessionId: "natural-exit-child",
            command: "/bin/sh",
            args: [
              "-c",
              `sleep 0.15; trap "" HUP; sleep 300 </dev/null >/dev/null 2>&1 & child=$!; echo "$child" > ${JSON.stringify(childPidPath)}; sleep 0.15; exit 7`,
            ],
            cwd: process.cwd(),
            cols: 80,
            rows: 24,
          }),
        );
        const exited = new Promise<number>((resolve) => {
          host.onExit("natural-exit-child", (event) => resolve(event.exitCode));
        });
        yield* Effect.promise(() =>
          waitFor(() =>
            fs.stat(childPidPath).then(
              () => true,
              () => false,
            ),
          ),
        );
        childPid = Number(yield* Effect.promise(() => fs.readFile(childPidPath, "utf8")));
        expect(childPid).toBeGreaterThan(0);

        expect(yield* Effect.promise(() => exited)).toBe(7);
        yield* Effect.promise(() => waitFor(() => pidDead(childPid!)));
        expect(host.isKilled("natural-exit-child")).toBe(false);
      } finally {
        try {
          yield* Effect.promise(() => host.dispose());
        } finally {
          if (childPid !== undefined && !pidDead(childPid)) {
            try {
              process.kill(childPid, "SIGKILL");
            } catch {
              // The host won the cleanup race.
            }
          }
          yield* Effect.promise(() => fs.rm(runtimeDir, { recursive: true, force: true }));
        }
      }
    }),
  );
});
