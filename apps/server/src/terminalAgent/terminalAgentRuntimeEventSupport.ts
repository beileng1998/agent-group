import {
  CommandId,
  EventId,
  MessageId,
  type ProviderRuntimeEvent,
  type ServerSettings,
} from "@agent-group/contracts";
import { Effect } from "effect";

import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine";
import type { ExecutionAdapterCoordinatorShape } from "../orchestration/Services/ExecutionAdapterCoordinator";
import type { ProviderRuntimeIngestionShape } from "../orchestration/Services/ProviderRuntimeIngestion";
import type { ActiveTerminalTurn, TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";
import type { TerminalAgentProviderResumeCursor } from "./terminalAgentProtocol";

export interface RuntimeEventDependencies {
  readonly runtime: TerminalAgentRuntimeRecord;
  readonly getSettings: () => Promise<ServerSettings>;
  readonly coordinator: ExecutionAdapterCoordinatorShape;
  readonly engine: OrchestrationEngineShape;
  readonly ingestion: ProviderRuntimeIngestionShape;
  readonly adoptProviderResumeCursor: (
    cursor: TerminalAgentProviderResumeCursor,
    providerSessionId: string,
  ) => Promise<void>;
}

export const terminalEventKey = (runtime: TerminalAgentRuntimeRecord, id: string, tag: string) =>
  `terminal:${runtime.runtimeInstanceId}:${id}:${tag}`;

export function assertTerminalHookNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error("Terminal hook handling was interrupted.");
  }
}

export function terminalProviderEventBase(
  runtime: TerminalAgentRuntimeRecord,
  id: string,
  turn?: ActiveTerminalTurn,
) {
  return {
    eventId: EventId.makeUnsafe(terminalEventKey(runtime, id, "runtime")),
    provider: runtime.provider,
    threadId: runtime.threadId,
    createdAt: new Date().toISOString(),
    ...(turn ? { turnId: turn.turnId } : {}),
    ...(turn?.providerTurnId ? { providerRefs: { providerTurnId: turn.providerTurnId } } : {}),
    terminalRuntimeFence: {
      revision: runtime.revision,
      generation: runtime.generation,
    },
  } as const;
}

export async function assertCurrentTerminalRuntime(
  runtime: TerminalAgentRuntimeRecord,
  coordinator: ExecutionAdapterCoordinatorShape,
): Promise<void> {
  const state = await Effect.runPromise(coordinator.getState(runtime.threadId));
  if (
    state.adapter !== "terminal" ||
    state.revision !== runtime.revision ||
    state.runtimeInstanceId !== runtime.runtimeInstanceId ||
    state.generation !== runtime.generation
  ) {
    throw new Error("This Agent Terminal runtime is stale.");
  }
}

export async function updateTerminalRuntimeState(
  dependencies: RuntimeEventDependencies,
  patch: Parameters<ExecutionAdapterCoordinatorShape["updateTerminalState"]>[0]["patch"],
): Promise<void> {
  await Effect.runPromise(
    dependencies.coordinator.updateTerminalState({
      threadId: dependencies.runtime.threadId,
      revision: dependencies.runtime.revision,
      generation: dependencies.runtime.generation,
      patch,
    }),
  );
}

export async function observeTerminalMessage(
  dependencies: RuntimeEventDependencies,
  id: string,
  turn: ActiveTerminalTurn,
  role: "user" | "assistant",
  text: string,
): Promise<void> {
  await Effect.runPromise(
    dependencies.engine.dispatch({
      type: "thread.terminal-message.observe",
      commandId: CommandId.makeUnsafe(
        terminalEventKey(dependencies.runtime, id, `${role}:command`),
      ),
      threadId: dependencies.runtime.threadId,
      messageId: MessageId.makeUnsafe(
        terminalEventKey(dependencies.runtime, id, `${role}:message`),
      ),
      role,
      text,
      turnId: turn.turnId,
      terminalRuntimeFence: {
        revision: dependencies.runtime.revision,
        generation: dependencies.runtime.generation,
      },
      createdAt: new Date().toISOString(),
    }),
  );
}

export async function publishTerminalRuntimeEvent(
  dependencies: RuntimeEventDependencies,
  event: ProviderRuntimeEvent,
): Promise<void> {
  await Effect.runPromise(dependencies.ingestion.publishTerminal(event));
}
