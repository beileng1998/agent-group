// FILE: TerminalHost.test.ts
// Purpose: Verifies the managed-agent PTY host contract — create-or-attach
// identity, generation epochs, monotonic output sequencing with snapshot
// dedupe, tombstones, and process-group teardown.
// Layer: Server terminal host tests

import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { expect } from "vitest";

import { makeNodePtyLayer } from "../terminal/Layers/NodePTY";
import { PtyAdapter, type PtyAdapterShape } from "../terminal/Services/PTY";
import { defaultProcessTreeKiller } from "../terminal/processTreeKiller";
import {
  TerminalHost,
  TerminalHostSessionNotFoundError,
  TerminalHostStaleGenerationError,
  type TerminalHostOutput,
} from "./TerminalHost";

const PtyTestLayer = makeNodePtyLayer().pipe(Layer.provide(NodeServices.layer));

const makeHost = (adapter: PtyAdapterShape) =>
  new TerminalHost({
    spawnPty: (input) => Effect.runPromise(adapter.spawn(input)),
    killGraceMs: 300,
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
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

const onWindows = process.platform === "win32";

it.layer(PtyTestLayer)("TerminalHost", (it) => {
  it.effect(
    "spawns, streams monotonic sequenced output, and reattaches with a dedupe snapshot",
    () =>
      Effect.gen(function* () {
        if (onWindows) return;
        const adapter = yield* PtyAdapter;
        const host = makeHost(adapter);
        try {
          const created = yield* Effect.promise(() =>
            host.createOrAttach({
              sessionId: "s1",
              command: "/bin/cat",
              cwd: process.cwd(),
              cols: 80,
              rows: 24,
            }),
          );
          expect(created.isNew).toBe(true);
          expect(created.snapshot).toBeNull();
          expect(created.generation).toBeTruthy();
          expect(created.pid).toBeGreaterThan(0);

          const outputs: TerminalHostOutput[] = [];
          host.onOutput("s1", (output) => outputs.push(output));
          host.write("s1", "hello-host\n");
          yield* Effect.promise(() =>
            waitFor(() => outputs.some((output) => output.data.includes("hello-host"))),
          );
          const seqs = outputs.map((output) => output.seq);
          expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
          for (const output of outputs) {
            expect(output.generation).toBe(created.generation);
          }

          const reattached = yield* Effect.promise(() => host.attach("s1"));
          expect(reattached.isNew).toBe(false);
          expect(reattached.generation).toBe(created.generation);
          expect(reattached.snapshot).not.toBeNull();
          // The attach contract: clients drop live output with
          // seq <= outputSequence, so nothing already inside the snapshot
          // renders twice.
          const maxSeq = Math.max(...seqs);
          expect(reattached.snapshot!.outputSequence).toBeGreaterThanOrEqual(maxSeq);
          expect(reattached.snapshot!.snapshotAnsi).toContain("hello-host");
        } finally {
          yield* Effect.promise(() => host.dispose());
        }
      }),
  );

  it.effect(
    "rejects writes carrying a stale generation",
    () =>
      Effect.gen(function* () {
        if (onWindows) return;
        const adapter = yield* PtyAdapter;
        const host = makeHost(adapter);
        try {
          const created = yield* Effect.promise(() =>
            host.createOrAttach({
              sessionId: "s2",
              command: "/bin/cat",
              cwd: process.cwd(),
              cols: 80,
              rows: 24,
            }),
          );
          expect(() => host.write("s2", "x", "not-the-generation")).toThrow(
            TerminalHostStaleGenerationError,
          );
          expect(() => host.write("s2", "ok", created.generation)).not.toThrow();
          expect(host.generationOf("s2")).toBe(created.generation);
        } finally {
          yield* Effect.promise(() => host.dispose());
        }
      }),
  );

  it.effect(
    "kills the whole process tree and tombstones the session",
    () =>
      Effect.gen(function* () {
        if (onWindows) return;
        const adapter = yield* PtyAdapter;
        const host = makeHost(adapter);
        const created = yield* Effect.promise(() =>
          host.createOrAttach({
            sessionId: "s3",
            command: "/bin/sh",
            args: ["-c", "sleep 300 & wait"],
            cwd: process.cwd(),
            cols: 80,
            rows: 24,
          }),
        );
        const tree = defaultProcessTreeKiller.capture(created.pid);
        yield* Effect.promise(() => host.kill("s3"));

        expect(host.isKilled("s3")).toBe(true);
        expect(host.isAlive("s3")).toBe(false);
        expect(host.generationOf("s3")).toBeNull();
        expect(() => host.write("s3", "x")).toThrow(TerminalHostSessionNotFoundError);
        yield* Effect.promise(() => waitFor(() => pidDead(created.pid)));
        for (const descendant of tree.descendants) {
          yield* Effect.promise(() => waitFor(() => pidDead(descendant.pid)));
        }
      }),
  );

  it.effect(
    "reports natural exit and forgets the session",
    () =>
      Effect.gen(function* () {
        if (onWindows) return;
        const adapter = yield* PtyAdapter;
        const host = makeHost(adapter);
        try {
          yield* Effect.promise(() =>
            host.createOrAttach({
              sessionId: "s4",
              command: "/bin/sh",
              args: ["-c", "exit 7"],
              cwd: process.cwd(),
              cols: 80,
              rows: 24,
            }),
          );
          const exited = deferred<number>();
          host.onExit("s4", (exit) => exited.resolve(exit.exitCode));
          const exitCode = yield* Effect.promise(() => exited.promise);
          expect(exitCode).toBe(7);
          yield* Effect.promise(() => waitFor(() => !host.isAlive("s4")));
          yield* Effect.promise(() =>
            expect(host.attach("s4")).rejects.toThrow(TerminalHostSessionNotFoundError),
          );
          expect(host.isKilled("s4")).toBe(false);
          expect(host.generationOf("s4")).toBeNull();
        } finally {
          yield* Effect.promise(() => host.dispose());
        }
      }),
  );

  it.effect(
    "createOrAttach reuses the live session instead of spawning a second runtime",
    () =>
      Effect.gen(function* () {
        if (onWindows) return;
        const adapter = yield* PtyAdapter;
        const host = makeHost(adapter);
        try {
          const spawnInput = {
            sessionId: "s5",
            command: "/bin/cat",
            cwd: process.cwd(),
            cols: 80,
            rows: 24,
          };
          const first = yield* Effect.promise(() => host.createOrAttach(spawnInput));
          const second = yield* Effect.promise(() => host.createOrAttach(spawnInput));
          expect(second.isNew).toBe(false);
          expect(second.generation).toBe(first.generation);
          expect(second.pid).toBe(first.pid);
        } finally {
          yield* Effect.promise(() => host.dispose());
        }
      }),
  );
});
