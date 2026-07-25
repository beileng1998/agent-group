import {
  DEFAULT_SERVER_SETTINGS,
  ThreadId,
  type OrchestrationCommand,
  type ProviderRuntimeEvent,
} from "@agent-group/contracts";
import { Effect, Stream } from "effect";

import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine";
import type {
  ExecutionAdapterCoordinatorShape,
  ExecutionAdapterState,
} from "../orchestration/Services/ExecutionAdapterCoordinator";
import type { ProviderRuntimeIngestionShape } from "../orchestration/Services/ProviderRuntimeIngestion";
import { makeTerminalAgentBridgeHandler } from "./terminalAgentRuntimeEvents";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";

const threadId = ThreadId.makeUnsafe("thread-terminal-events");

export function makeRuntimeEventsHarness(
  provider: "pi" | "claudeAgent" = "pi",
) {
  const commands: OrchestrationCommand[] = [];
  const events: ProviderRuntimeEvent[] = [];
  const adoptedCursors: unknown[] = [];
  let failNextDispatch = false;
  let failNextPublish = false;
  let failNextAdoption = false;
  let hangNextAdoption = false;
  let adoptionStarted = false;
  let resolveHungAdoption: (() => void) | undefined;
  let releasedClaims = 0;
  let state: ExecutionAdapterState = {
    adapter: "terminal",
    revision: 3,
    provider,
    status: "checking",
    runtimeInstanceId: "runtime-1",
    generation: "generation-1",
    pid: 41,
    ownerIdentity: {
      pid: 41,
      startTime: "Sat Jul 25 00:00:00 2026",
      commandFingerprint: "0".repeat(64),
    },
    processGroupIdentity: null,
    providerSessionId: "provider-session-1",
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
    }) =>
      Effect.succeed({
        ...input,
        release: Effect.sync(() => {
          releasedClaims += 1;
        }),
      }),
    updateTerminalState: (input: { patch: Record<string, unknown> }) =>
      Effect.sync(() => {
        if (state.adapter !== "terminal") throw new Error("not terminal");
        state = { ...state, ...input.patch } as ExecutionAdapterState;
        return state;
      }),
  } as unknown as ExecutionAdapterCoordinatorShape;
  const engine = {
    dispatch: (command: OrchestrationCommand) =>
      Effect.sync(() => {
        if (failNextDispatch) {
          failNextDispatch = false;
          throw new Error("command unavailable");
        }
        commands.push(command);
        return { sequence: commands.length };
      }),
  } as unknown as OrchestrationEngineShape;
  const ingestion = {
    start: Effect.void,
    drain: Effect.void,
    publishTerminal: (event: ProviderRuntimeEvent) =>
      Effect.sync(() => {
        if (failNextPublish) {
          failNextPublish = false;
          throw new Error("projection unavailable");
        }
        events.push(event);
      }),
  } satisfies ProviderRuntimeIngestionShape;
  const runtime: TerminalAgentRuntimeRecord = {
    threadId,
    provider,
    modelSelection: {
      provider,
      model: "openai/gpt-5",
    } as TerminalAgentRuntimeRecord["modelSelection"],
    runtimeMode: "full-access",
    workspaceRoot: "/workspace",
    coordinates: {
      workspaceRoot: "/workspace",
      groupId: "group-1" as never,
      sessionId: threadId,
      createdAt: new Date().toISOString(),
    },
    runtimeInstanceId: "runtime-1",
    runtimeDir: "/runtime",
    revision: 3,
    generation: "generation-1",
    providerSessionId: "provider-session-1",
    capabilities: {
      cliVersion: "1.0.0",
      authentication: "authenticated",
      authMethod: "test",
      apiProvider: "test",
      hookSchema: "cli-verified",
    },
    model: "openai/gpt-5",
    effort: null,
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
  let settings = {
    ...DEFAULT_SERVER_SETTINGS,
    enableManagedAgentTerminal: true,
    agentGroup: {
      ...DEFAULT_SERVER_SETTINGS.agentGroup,
      contextEnabled: false,
    },
  };
  const handler = makeTerminalAgentBridgeHandler({
    runtime,
    getSettings: async () => settings,
    coordinator,
    engine,
    ingestion,
    adoptProviderResumeCursor: async (cursor) => {
      if (hangNextAdoption) {
        adoptionStarted = true;
        await new Promise<void>((resolve) => {
          resolveHungAdoption = resolve;
        });
      }
      if (failNextAdoption) {
        failNextAdoption = false;
        throw new Error("cursor persistence unavailable");
      }
      adoptedCursors.push(cursor);
    },
  });
  const invoke = (input: unknown, eventId?: string, mode?: string) =>
    handler(
      {
        runtimeInstanceId: runtime.runtimeInstanceId,
        input,
        ...(eventId ? { eventId } : {}),
        ...(mode ? { mode } : {}),
      },
      new AbortController().signal,
    );
  return {
    commands,
    events,
    adoptedCursors,
    runtime,
    invoke,
    getState: () => state,
    setState: (next: ExecutionAdapterState) => {
      state = next;
    },
    failNextPublish: () => {
      failNextPublish = true;
    },
    failNextDispatch: () => {
      failNextDispatch = true;
    },
    failNextAdoption: () => {
      failNextAdoption = true;
    },
    hangNextAdoption: () => {
      hangNextAdoption = true;
    },
    adoptionStarted: () => adoptionStarted,
    resolveHungAdoption: () => resolveHungAdoption?.(),
    releasedClaims: () => releasedClaims,
    setManagedTerminalEnabled: (enabled: boolean) => {
      settings = { ...settings, enableManagedAgentTerminal: enabled };
    },
    handler,
  };
}

export async function handshakeRuntimeEventsHarness(
  harness: ReturnType<typeof makeRuntimeEventsHarness>,
) {
  await harness.invoke(
    harness.runtime.provider === "pi"
      ? {
          event_name: "session_start",
          event_id: "session-start-1",
          session_id: "provider-session-1",
          session_file: "/sessions/provider-session-1.jsonl",
          reason: "startup",
        }
      : {
          hook_event_name: "SessionStart",
          session_id: "provider-session-1",
          source: "startup",
        },
    "session-start-1",
  );
}
