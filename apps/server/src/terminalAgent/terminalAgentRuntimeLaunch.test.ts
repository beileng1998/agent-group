import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DEFAULT_SERVER_SETTINGS, ThreadId } from "@agent-group/contracts";
import { Effect, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ExecutionAdapterError,
  type ExecutionAdapterCoordinatorShape,
  type ExecutionAdapterState,
} from "../orchestration/Services/ExecutionAdapterCoordinator";
import type { TerminalAgentBridgeShape } from "./Services/TerminalAgentBridge";
import { claudeTerminalRuntimeDir } from "./claudeTerminalDriver";
import { codexTerminalRuntimeDir } from "./codexTerminalDriver";
import { launchTerminalRuntime } from "./terminalAgentRuntimeLaunch";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("launchTerminalRuntime compensation", () => {
  it("tears down a live PTY when the post-start authority update fails", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-launch-"));
    directories.push(stateDir);
    const threadId = ThreadId.makeUnsafe("terminal-launch-thread");
    let state: ExecutionAdapterState = {
      adapter: "structured",
      revision: 0,
      status: "ready",
    };
    let abortCalls = 0;
    let unregisterCalls = 0;
    let preparedArgs: ReadonlyArray<string> | undefined;
    const coordinator = {
      getState: () => Effect.sync(() => state),
      streamChanges: Stream.empty,
      switchToTerminal: (
        input: Parameters<ExecutionAdapterCoordinatorShape["switchToTerminal"]>[0],
      ) =>
        Effect.gen(function* () {
          const prepared = yield* input.prepare({
            provider: "codex",
            status: "closed",
            runtimeMode: "full-access",
            threadId,
            resumeCursor: { threadId: "latest-codex-thread" },
            createdAt: "2026-07-25T00:00:00.000Z",
            updatedAt: "2026-07-25T00:00:00.000Z",
          });
          preparedArgs = prepared.spawn.args;
          state = {
            adapter: "terminal",
            revision: 1,
            provider: "codex",
            status: "ready",
            runtimeInstanceId: "runtime-1",
            generation: "generation-1",
            pid: 42,
            ownerIdentity: {
              pid: 42,
              startTime: "Sat Jul 25 00:00:00 2026",
              commandFingerprint: "0".repeat(64),
            },
            processGroupIdentity: null,
            providerSessionId: prepared.providerSessionId,
            activeTurnId: null,
            startedAt: "2026-07-25T00:00:00.000Z",
            exitCode: null,
            exitSignal: null,
            error: null,
          };
          return {
            isNew: true,
            revision: 1,
            runtimeInstanceId: "runtime-1",
            generation: "generation-1",
            pid: 42,
          };
        }),
      updateTerminalState: () =>
        Effect.fail(
          new ExecutionAdapterError({
            reason: "turn-in-flight",
            message: "authority persistence failed",
          }),
        ),
      abortTerminalLaunch: () =>
        Effect.sync(() => {
          abortCalls += 1;
          state = { adapter: "structured", revision: 2, status: "ready" };
        }),
    } as unknown as ExecutionAdapterCoordinatorShape;
    const bridge = {
      endpoint: path.join(stateDir, "hook.sock"),
      register: () =>
        Effect.succeed({
          token: "bridge-token",
          pause: async () => {},
          resume: () => {},
          unregister: () => {
            unregisterCalls += 1;
          },
        }),
    } satisfies TerminalAgentBridgeShape;
    const records = new Map<ThreadId, TerminalAgentRuntimeRecord>();

    await expect(
      launchTerminalRuntime({
        dependencies: {
          stateDir,
          homeDir: stateDir,
          bridge,
          coordinator,
          engine: {} as never,
          ingestion: {} as never,
          childProcessSpawner: {} as never,
          getSettings: async () => DEFAULT_SERVER_SETTINGS,
          listProviderSessions: async () => [],
          readPersistedProviderResumeCursor: async () => null,
          revalidateLaunchContext: async () => ({
            target: {
              threadId,
              provider: "codex",
              modelSelection: { provider: "codex", model: "gpt-5" },
              runtimeMode: "full-access",
              workspaceRoot: stateDir,
              coordinates: {
                workspaceRoot: stateDir,
                groupId: "group-1" as never,
                sessionId: threadId,
                createdAt: "2026-07-25T00:00:00.000Z",
              },
            },
            settings: {
              ...DEFAULT_SERVER_SETTINGS,
              enableManagedAgentTerminal: true,
            },
          }),
          adoptProviderResumeCursor: async () => {},
          records,
        },
        target: {
          threadId,
          provider: "codex",
          modelSelection: { provider: "codex", model: "gpt-5" },
          runtimeMode: "full-access",
          workspaceRoot: stateDir,
          coordinates: {
            workspaceRoot: stateDir,
            groupId: "group-1" as never,
            sessionId: threadId,
            createdAt: "2026-07-25T00:00:00.000Z",
          },
        },
        settings: DEFAULT_SERVER_SETTINGS,
        capabilities: {
          cliVersion: "1.0.0",
          authentication: "authenticated",
          authMethod: "test",
          apiProvider: "openai",
          hookSchema: "cli-verified",
        },
        runtimeInstanceId: "runtime-1",
        providerSessionId: null,
        resume: false,
        operation: "start",
        transcriptBootstrap: null,
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow("authority persistence failed");

    expect(abortCalls).toBe(1);
    expect(unregisterCalls).toBe(1);
    expect(preparedArgs?.slice(0, 2)).toEqual([
      "--dangerously-bypass-hook-trust",
      "--no-alt-screen",
    ]);
    expect(records.has(threadId)).toBe(false);
    expect(state).toMatchObject({ adapter: "structured" });
    await expect(fs.lstat(codexTerminalRuntimeDir(stateDir, threadId))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("revalidates a restart before replacing the persisted runtime", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-restart-revalidate-"));
    directories.push(stateDir);
    const threadId = ThreadId.makeUnsafe("terminal-restart-revalidation");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      enableManagedAgentTerminal: true,
    };
    const target = {
      threadId,
      provider: "codex" as const,
      modelSelection: { provider: "codex" as const, model: "gpt-5" },
      runtimeMode: "full-access" as const,
      workspaceRoot: stateDir,
      coordinates: {
        workspaceRoot: stateDir,
        groupId: "group-1" as never,
        sessionId: threadId,
        createdAt: "2026-07-25T00:00:00.000Z",
      },
    };
    const restartTerminal = vi.fn(() => Effect.fail(new Error("unexpected restart")));
    const unregister = vi.fn();
    const coordinator = {
      getState: () =>
        Effect.succeed({
          adapter: "terminal",
          revision: 7,
          provider: "codex",
          status: "ready",
          runtimeInstanceId: "runtime-old",
          generation: "generation-old",
          pid: null,
          ownerIdentity: null,
          processGroupIdentity: null,
          providerSessionId: "session-old",
          activeTurnId: null,
          startedAt: "2026-07-25T00:00:00.000Z",
          exitCode: null,
          exitSignal: null,
          error: null,
        } as const),
      streamChanges: Stream.empty,
      restartTerminal,
    } as unknown as ExecutionAdapterCoordinatorShape;
    const bridge = {
      endpoint: path.join(stateDir, "hook.sock"),
      register: () =>
        Effect.succeed({
          token: "bridge-token",
          pause: async () => {},
          resume: () => {},
          unregister,
        }),
    } satisfies TerminalAgentBridgeShape;
    const records = new Map<ThreadId, TerminalAgentRuntimeRecord>();

    await expect(
      launchTerminalRuntime({
        dependencies: {
          stateDir,
          homeDir: stateDir,
          bridge,
          coordinator,
          engine: {} as never,
          ingestion: {} as never,
          childProcessSpawner: {} as never,
          getSettings: async () => settings,
          listProviderSessions: async () => [],
          readPersistedProviderResumeCursor: async () => null,
          revalidateLaunchContext: async () => ({
            target: {
              ...target,
              workspaceRoot: path.join(stateDir, "moved"),
            },
            settings,
          }),
          adoptProviderResumeCursor: async () => {},
          records,
        },
        target,
        settings,
        capabilities: {
          cliVersion: "1.0.0",
          authentication: "authenticated",
          authMethod: "test",
          apiProvider: "openai",
          hookSchema: "cli-verified",
        },
        runtimeInstanceId: "runtime-new",
        providerSessionId: "session-old",
        resume: true,
        operation: "restart",
        transcriptBootstrap: null,
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow("changed");

    expect(restartTerminal).not.toHaveBeenCalled();
    expect(unregister).toHaveBeenCalledOnce();
    expect(records.has(threadId)).toBe(false);
  });

  it("retires a replaced runtime directory when the new epoch fails", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-restart-cleanup-"));
    directories.push(stateDir);
    const threadId = ThreadId.makeUnsafe("terminal-restart-cleanup");
    const oldRuntimeDir = claudeTerminalRuntimeDir(stateDir, "runtime-old");
    await fs.mkdir(oldRuntimeDir, { recursive: true });
    await fs.writeFile(path.join(oldRuntimeDir, "old-hook-token"), "secret");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      enableManagedAgentTerminal: true,
    };
    const target = {
      threadId,
      provider: "claudeAgent" as const,
      modelSelection: {
        provider: "claudeAgent" as const,
        model: "claude-sonnet-4-5",
      },
      runtimeMode: "full-access" as const,
      workspaceRoot: stateDir,
      coordinates: {
        workspaceRoot: stateDir,
        groupId: "group-1" as never,
        sessionId: threadId,
        createdAt: "2026-07-25T00:00:00.000Z",
      },
    };
    let state: ExecutionAdapterState = {
      adapter: "terminal",
      revision: 7,
      provider: "claudeAgent",
      status: "ready",
      runtimeInstanceId: "runtime-old",
      generation: "generation-old",
      pid: null,
      ownerIdentity: null,
      processGroupIdentity: null,
      providerSessionId: "session-old",
      activeTurnId: null,
      startedAt: "2026-07-25T00:00:00.000Z",
      exitCode: null,
      exitSignal: null,
      error: null,
    };
    const coordinator = {
      getState: () => Effect.sync(() => state),
      streamChanges: Stream.empty,
      restartTerminal: () =>
        Effect.gen(function* () {
          state = {
            ...state,
            adapter: "terminal",
            revision: 8,
            status: "error",
            runtimeInstanceId: "runtime-new",
            generation: null,
            pid: null,
            ownerIdentity: null,
            processGroupIdentity: null,
          };
          return yield* Effect.fail(
            new ExecutionAdapterError({
              reason: "host",
              message: "new PTY failed",
            }),
          );
        }),
      updateTerminalState: (input: {
        patch: Partial<Extract<ExecutionAdapterState, { adapter: "terminal" }>>;
      }) =>
        Effect.sync(() => {
          state = { ...state, ...input.patch } as ExecutionAdapterState;
          return state as Extract<ExecutionAdapterState, { adapter: "terminal" }>;
        }),
    } as unknown as ExecutionAdapterCoordinatorShape;
    const unregisterOld = vi.fn();
    const records = new Map<ThreadId, TerminalAgentRuntimeRecord>([
      [
        threadId,
        {
          threadId,
          runtimeInstanceId: "runtime-old",
          runtimeDir: oldRuntimeDir,
          revision: 7,
          generation: "generation-old",
          unregisterHook: unregisterOld,
        } as unknown as TerminalAgentRuntimeRecord,
      ],
    ]);
    const bridge = {
      endpoint: path.join(stateDir, "hook.sock"),
      register: () =>
        Effect.succeed({
          token: "bridge-token",
          pause: async () => {},
          resume: () => {},
          unregister: () => {},
        }),
    } satisfies TerminalAgentBridgeShape;

    await expect(
      launchTerminalRuntime({
        dependencies: {
          stateDir,
          homeDir: stateDir,
          bridge,
          coordinator,
          engine: {} as never,
          ingestion: {} as never,
          childProcessSpawner: {} as never,
          getSettings: async () => settings,
          listProviderSessions: async () => [],
          readPersistedProviderResumeCursor: async () => null,
          revalidateLaunchContext: async () => ({ target, settings }),
          adoptProviderResumeCursor: async () => {},
          records,
        },
        target,
        settings,
        capabilities: {
          cliVersion: "1.0.0",
          authentication: "authenticated",
          authMethod: "test",
          apiProvider: "anthropic",
          hookSchema: "cli-verified",
        },
        runtimeInstanceId: "runtime-new",
        providerSessionId: "session-old",
        resume: true,
        operation: "restart",
        transcriptBootstrap: null,
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow("new PTY failed");

    expect(unregisterOld).toHaveBeenCalledOnce();
    await expect(fs.lstat(oldRuntimeDir)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(records.get(threadId)?.runtimeInstanceId).toBe("runtime-new");
  });
});
