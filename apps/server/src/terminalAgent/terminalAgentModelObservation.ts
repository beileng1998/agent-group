import { CommandId } from "@agent-group/contracts";
import { Effect } from "effect";

import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine";
import type { ExecutionAdapterCoordinatorShape } from "../orchestration/Services/ExecutionAdapterCoordinator";
import {
  terminalAgentModelSelectionFromObservation,
  terminalAgentSelectionEffort,
} from "./terminalAgentModelSelection";
import type { TerminalAgentEvent } from "./terminalAgentProtocol";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";

type MetadataEvent = Extract<
  TerminalAgentEvent,
  { type: "session_start" | "prompt_submit" | "runtime_state" }
>;

export async function observeTerminalAgentModel(input: {
  readonly runtime: TerminalAgentRuntimeRecord;
  readonly coordinator: ExecutionAdapterCoordinatorShape;
  readonly engine: OrchestrationEngineShape;
  readonly event: MetadataEvent;
  readonly commandKey: string;
}): Promise<void> {
  const nextSelection = terminalAgentModelSelectionFromObservation(
    input.runtime.modelSelection,
    input.event,
  );
  if (nextSelection !== input.runtime.modelSelection) {
    await Effect.runPromise(
      input.engine.dispatch({
        type: "thread.terminal-model.observe",
        commandId: CommandId.makeUnsafe(input.commandKey),
        threadId: input.runtime.threadId,
        modelSelection: nextSelection,
        terminalRuntimeFence: {
          revision: input.runtime.revision,
          generation: input.runtime.generation,
        },
        createdAt: new Date().toISOString(),
      }),
    );
  }

  const nextModel = input.event.model === undefined ? input.runtime.model : nextSelection.model;
  const nextEffort =
    input.event.effort === undefined
      ? input.runtime.effort
      : terminalAgentSelectionEffort(nextSelection);
  const nextPermission =
    input.event.permissionMode === undefined
      ? input.runtime.permission
      : input.event.permissionMode;
  const metadataChanged =
    nextSelection !== input.runtime.modelSelection ||
    nextModel !== input.runtime.model ||
    nextEffort !== input.runtime.effort ||
    nextPermission !== input.runtime.permission;

  input.runtime.modelSelection = nextSelection;
  input.runtime.model = nextModel;
  input.runtime.effort = nextEffort;
  input.runtime.permission = nextPermission;

  const shouldPublishState =
    input.event.type !== "session_start" &&
    (metadataChanged || input.runtime.metadataStatePublicationPending);
  if (shouldPublishState) {
    input.runtime.metadataStatePublicationPending = true;
    await Effect.runPromise(
      input.coordinator.updateTerminalState({
        threadId: input.runtime.threadId,
        revision: input.runtime.revision,
        generation: input.runtime.generation,
        patch: {},
      }),
    );
    input.runtime.metadataStatePublicationPending = false;
  }
}
