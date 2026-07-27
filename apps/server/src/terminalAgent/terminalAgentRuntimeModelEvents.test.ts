import {
  DEFAULT_SERVER_SETTINGS,
  ThreadId,
  type OrchestrationCommand,
  type ProviderRuntimeEvent,
  type TerminalAgentProvider,
} from "@agent-group/contracts";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine";
import type {
  ExecutionAdapterCoordinatorShape,
  ExecutionAdapterState,
} from "../orchestration/Services/ExecutionAdapterCoordinator";
import type { ProviderRuntimeIngestionShape } from "../orchestration/Services/ProviderRuntimeIngestion";
import { makeTerminalAgentBridgeHandler } from "./terminalAgentRuntimeEvents";
import type {
  ManagedTerminalModelSelection,
  TerminalAgentRuntimeRecord,
} from "./terminalAgentRuntimeTypes";

const threadId = ThreadId.makeUnsafe("thread-terminal-model-events");

function makeHarness(
  provider: TerminalAgentProvider,
  modelSelection: ManagedTerminalModelSelection,
) {
  const commands: OrchestrationCommand[] = [];
  const events: ProviderRuntimeEvent[] = [];
  let failNextStateUpdate = false;
  let state: ExecutionAdapterState = {
    adapter: "terminal",
    revision: 3,
    provider,
    status: "checking",
    runtimeInstanceId: "runtime-model",
    generation: "generation-model",
    pid: 41,
    ownerIdentity: {
      pid: 41,
      startTime: "Sat Jul 25 00:00:00 2026",
      commandFingerprint: "0".repeat(64),
    },
    processGroupIdentity: null,
    providerSessionId: null,
    activeTurnId: null,
    startedAt: new Date().toISOString(),
    exitCode: null,
    exitSignal: null,
    error: null,
  };
  const coordinator = {
    getState: () => Effect.sync(() => state),
    streamChanges: Stream.empty,
    acquireTerminalOperation: (input: {
      threadId: typeof threadId;
      revision: number;
      generation: string;
      claimId: string;
    }) => Effect.succeed({ ...input, release: Effect.void }),
    updateTerminalState: (input: { patch: Record<string, unknown> }) =>
      Effect.sync(() => {
        if (failNextStateUpdate) {
          failNextStateUpdate = false;
          throw new Error("state unavailable");
        }
        state = { ...state, ...input.patch } as ExecutionAdapterState;
        return state;
      }),
  } as unknown as ExecutionAdapterCoordinatorShape;
  const engine = {
    dispatch: (command: OrchestrationCommand) =>
      Effect.sync(() => {
        commands.push(command);
        return { sequence: commands.length };
      }),
  } as unknown as OrchestrationEngineShape;
  const ingestion = {
    start: Effect.void,
    drain: Effect.void,
    publishTerminal: (event: ProviderRuntimeEvent) =>
      Effect.sync(() => {
        events.push(event);
      }),
  } satisfies ProviderRuntimeIngestionShape;
  const runtime: TerminalAgentRuntimeRecord = {
    threadId,
    provider,
    modelSelection,
    runtimeMode: "full-access",
    workspaceRoot: "/workspace",
    coordinates: {
      workspaceRoot: "/workspace",
      groupId: "group-model" as never,
      sessionId: threadId,
      createdAt: new Date().toISOString(),
    },
    runtimeInstanceId: "runtime-model",
    runtimeDir: "/runtime",
    revision: 3,
    generation: "generation-model",
    providerSessionId: null,
    capabilities: {
      cliVersion: "1.0.0",
      authentication: "authenticated",
      authMethod: "test",
      apiProvider: "test",
      hookSchema: "cli-verified",
    },
    model: modelSelection.model,
    effort:
      modelSelection.provider === "codex"
        ? (modelSelection.options?.reasoningEffort ?? null)
        : modelSelection.provider === "claudeAgent"
          ? (modelSelection.options?.effort ?? null)
          : (modelSelection.options?.thinkingLevel ?? null),
    permission: null,
    context: null,
    activeTurn: null,
    transcriptBootstrap: null,
    handshakeReceived: false,
    metadataStatePublicationPending: false,
    pauseHook: async () => {},
    resumeHook: () => {},
    unregisterHook: () => {},
    eventResponses: new Map(),
  };
  const handler = makeTerminalAgentBridgeHandler({
    runtime,
    getSettings: async () => ({
      ...DEFAULT_SERVER_SETTINGS,
      enableManagedAgentTerminal: true,
      agentGroup: {
        ...DEFAULT_SERVER_SETTINGS.agentGroup,
        contextEnabled: false,
      },
    }),
    coordinator,
    engine,
    ingestion,
    maybeGenerateAndRenameThreadTitleForFirstTurn: async () => {},
    adoptProviderResumeCursor: async () => {},
  });
  const invoke = (input: unknown, eventId: string, mode?: string) =>
    handler(
      {
        runtimeInstanceId: runtime.runtimeInstanceId,
        input,
        eventId,
        ...(mode ? { mode } : {}),
      },
      new AbortController().signal,
    );
  return {
    commands,
    events,
    runtime,
    invoke,
    failNextStateUpdate: () => {
      failNextStateUpdate = true;
    },
  };
}

async function handshake(harness: ReturnType<typeof makeHarness>) {
  const { provider, model } = harness.runtime;
  if (provider === "codex") {
    await harness.invoke(
      {
        hook_event_name: "SessionStart",
        session_id: "session-model",
        cwd: "/workspace",
        transcript_path: null,
        model,
        permission_mode: "default",
        source: "startup",
      },
      "session-start",
    );
  } else if (provider === "claudeAgent") {
    await harness.invoke(
      {
        hook_event_name: "SessionStart",
        session_id: "session-model",
        model,
        effort: { level: harness.runtime.effort },
        source: "startup",
      },
      "session-start",
    );
  } else {
    await harness.invoke(
      {
        event_name: "session_start",
        event_id: "session-start",
        session_id: "session-model",
        session_file: "/sessions/session-model.jsonl",
        reason: "startup",
        model,
        thinking_level: harness.runtime.effort,
      },
      "session-start",
    );
  }
}

describe("managed terminal runtime model events", () => {
  it("observes a Codex prompt model before accepting its Turn", async () => {
    const harness = makeHarness("codex", {
      provider: "codex",
      model: "gpt-5.2-codex",
      options: { reasoningEffort: "high", fastMode: true },
    });
    await handshake(harness);
    await harness.invoke(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-model",
        cwd: "/workspace",
        transcript_path: null,
        model: "gpt-5.3-codex",
        permission_mode: "default",
        turn_id: "provider-turn",
        prompt: "Use the current model.",
      },
      "prompt-model",
    );

    expect(harness.commands[0]).toMatchObject({
      type: "thread.terminal-model.observe",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.3-codex",
        options: { reasoningEffort: "high", fastMode: true },
      },
      terminalRuntimeFence: { revision: 3, generation: "generation-model" },
    });
    await harness.invoke({ prompt: "Use the current model." }, "prompt-model", "prompt-accepted");
    expect(harness.events.at(-1)).toMatchObject({
      type: "turn.started",
      payload: { model: "gpt-5.3-codex", effort: "high" },
    });
  });

  it("observes Claude status-line model and effort changes", async () => {
    const harness = makeHarness("claudeAgent", {
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      options: { thinking: true, effort: "high", fastMode: true },
    });
    await handshake(harness);
    await harness.invoke(
      {
        session_id: "session-model",
        model: { id: "claude-opus-4-7" },
        effort: { level: "max" },
      },
      "status-model",
      "status-line",
    );

    expect(harness.commands.at(-1)).toMatchObject({
      type: "thread.terminal-model.observe",
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-7",
        options: { thinking: true, effort: "max", fastMode: true },
      },
    });
  });

  it("observes Pi runtime model and thinking-level changes", async () => {
    const harness = makeHarness("pi", {
      provider: "pi",
      model: "openai/gpt-5",
      options: { thinkingLevel: "medium" },
    });
    await handshake(harness);
    await harness.invoke(
      {
        event_name: "runtime_state",
        event_id: "runtime-model",
        session_id: "session-model",
        model: "openai/gpt-5.1",
        thinking_level: "xhigh",
      },
      "runtime-model",
    );

    expect(harness.commands.at(-1)).toMatchObject({
      type: "thread.terminal-model.observe",
      modelSelection: {
        provider: "pi",
        model: "openai/gpt-5.1",
        options: { thinkingLevel: "xhigh" },
      },
    });
  });

  it("retains committed metadata and retries a failed state publication", async () => {
    const harness = makeHarness("pi", {
      provider: "pi",
      model: "openai/gpt-5",
      options: { thinkingLevel: "medium" },
    });
    await handshake(harness);
    const update = {
      event_name: "runtime_state",
      event_id: "runtime-retry",
      session_id: "session-model",
      model: "openai/gpt-5.1",
      thinking_level: "high",
    };
    harness.failNextStateUpdate();

    await expect(harness.invoke(update, "runtime-retry")).rejects.toThrow("state unavailable");
    expect(harness.runtime.modelSelection).toMatchObject({
      model: "openai/gpt-5.1",
      options: { thinkingLevel: "high" },
    });
    expect(harness.runtime.metadataStatePublicationPending).toBe(true);

    await harness.invoke(update, "runtime-retry");
    const modelCommands = harness.commands.filter(
      (command) => command.type === "thread.terminal-model.observe",
    );
    expect(modelCommands).toHaveLength(1);
    expect(harness.runtime.modelSelection).toMatchObject({
      model: "openai/gpt-5.1",
      options: { thinkingLevel: "high" },
    });
    expect(harness.runtime.metadataStatePublicationPending).toBe(false);
  });
});
