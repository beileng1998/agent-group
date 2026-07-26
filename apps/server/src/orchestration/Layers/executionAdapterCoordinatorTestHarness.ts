import { ThreadId, type ProviderSession } from "@agent-group/contracts";
import { Cause, Effect, Exit } from "effect";

import type { TerminalHostExit } from "../../terminalHost/TerminalHost";
import {
  TerminalHostError,
  type TerminalHostServiceShape,
} from "../../terminalHost/TerminalHostService";
import type { ExecutionAdapterError } from "../Services/ExecutionAdapterCoordinator";
import { makeExecutionAdapterAuthority } from "./ExecutionAdapterAuthority";
import { makeExecutionAdapterCoordinator } from "./ExecutionAdapterCoordinator";

export const coordinatorTestThreadId = ThreadId.makeUnsafe("thread-terminal");
export const coordinatorTestSpawn = {
  command: "/trusted/codex",
  args: ["--resume"],
  cwd: "/workspace",
  cols: 80,
  rows: 24,
} as const;

export const coordinatorTestStructuredSession: ProviderSession = {
  threadId: coordinatorTestThreadId,
  provider: "codex",
  status: "ready",
  runtimeMode: "full-access",
  cwd: "/workspace",
  model: "gpt-5",
  resumeCursor: "cursor-1",
  createdAt: "2026-07-25T00:00:00.000Z",
  updatedAt: "2026-07-25T00:00:00.000Z",
};

export function executionAdapterFailureReason(
  exit: Exit.Exit<unknown, unknown>,
): string | undefined {
  if (!Exit.isFailure(exit)) return undefined;
  const failure = Cause.findErrorOption(exit.cause);
  return failure._tag === "Some" ? (failure.value as ExecutionAdapterError).reason : undefined;
}

function makeFakeHost() {
  const state = {
    alive: false,
    killed: false,
    spawnFails: false,
    killFails: false,
    writes: [] as string[],
    writeGate: null as Promise<void> | null,
    onWriteStarted: null as (() => void) | null,
    exitListener: null as ((exit: TerminalHostExit) => void) | null,
  };
  const attached = {
    isNew: true,
    generation: "generation-1",
    pid: 42,
    processGroupIdentity: null,
    snapshot: null,
  } as const;
  const host: TerminalHostServiceShape = {
    createOrAttach: () =>
      state.spawnFails
        ? Effect.fail(new TerminalHostError({ reason: "spawn-failed", message: "spawn failed" }))
        : Effect.sync(() => {
            state.alive = true;
            return attached;
          }),
    attach: () => Effect.succeed(attached),
    attachClient: (_sessionId, listeners) =>
      Effect.sync(() => {
        state.exitListener = listeners.onExit;
        return { attached, unsubscribe: () => {} };
      }),
    write: ({ data }) =>
      Effect.promise(async () => {
        state.onWriteStarted?.();
        if (state.writeGate) await state.writeGate;
        state.writes.push(data);
      }),
    resize: () => Effect.void,
    getSnapshot: () => Effect.succeed(null),
    onOutput: () => Effect.succeed(() => {}),
    onExit: (_sessionId, listener) =>
      Effect.sync(() => {
        state.exitListener = listener;
        return () => {
          state.exitListener = null;
        };
      }),
    kill: () =>
      state.killFails
        ? Effect.fail(new TerminalHostError({ reason: "teardown-failed", message: "kill failed" }))
        : Effect.sync(() => {
            state.alive = false;
            state.killed = true;
          }),
    isAlive: () => Effect.sync(() => state.alive),
    isKilled: () => Effect.sync(() => state.killed),
    generationOf: () => Effect.succeed(state.alive ? attached.generation : null),
  };
  return { host, state };
}

export async function makeExecutionAdapterCoordinatorTestHarness(input?: {
  readonly runtime?: ProviderSession;
  readonly findStructuredRuntime?: () => Effect.Effect<ProviderSession | undefined, unknown>;
  readonly suspendedRuntime?: ProviderSession;
  readonly spawnFails?: boolean;
  readonly killFails?: boolean;
  readonly resumeFails?: boolean;
  readonly identityCaptureFails?: boolean;
}) {
  const authority = await Effect.runPromise(
    makeExecutionAdapterAuthority({
      persist: () => Effect.void,
      now: () => new Date("2026-07-25T00:00:00.000Z"),
    }),
  );
  const { host, state } = makeFakeHost();
  state.spawnFails = input?.spawnFails ?? false;
  state.killFails = input?.killFails ?? false;
  const calls = { suspended: 0, resumed: 0, finalized: 0 };
  const coordinator = await Effect.runPromise(
    makeExecutionAdapterCoordinator({
      authority,
      terminalHost: host,
      captureOwnerIdentity: (pid) => {
        if (input?.identityCaptureFails) throw new Error("identity unavailable");
        return {
          pid,
          startTime: "2026-07-25T00:00:00.000Z",
          commandFingerprint: "0".repeat(64),
        };
      },
      findStructuredRuntime: input?.findStructuredRuntime ?? (() => Effect.succeed(input?.runtime)),
      suspendStructuredRuntime: (session) =>
        Effect.sync(() => {
          calls.suspended += 1;
          return {
            session: input?.suspendedRuntime ?? session,
            resume: input?.resumeFails
              ? Effect.fail(new Error("resume failed"))
              : Effect.sync(() => {
                  calls.resumed += 1;
                }),
            finalize: Effect.sync(() => {
              calls.finalized += 1;
            }),
          };
        }),
      supportedTerminalProviders: ["codex", "claudeAgent", "pi"],
      now: () => "2026-07-25T00:00:00.000Z",
    }),
  );
  return { authority, coordinator, hostState: state, calls };
}
