import type { OrchestrationCommand, OrchestrationReadModel } from "@agent-group/contracts";
import { Deferred, Ref } from "effect";

import {
  OrchestrationCommandInternalError,
  OrchestrationCommandTimeoutError,
  type OrchestrationDispatchError,
} from "../../Errors.ts";

export const ORCHESTRATION_DISPATCH_TIMEOUT_MS = 45_000;

export type CommandExecutionState = "queued" | "in-flight" | "abandoned";
export type DispatchTimeoutDecision = { kind: "abandon" } | { kind: "wait" };

export interface CommandEnvelope {
  readonly command: OrchestrationCommand;
  readonly result: Deferred.Deferred<{ sequence: number }, OrchestrationDispatchError>;
  readonly executionState: Ref.Ref<CommandExecutionState>;
  readonly deadlineAtMs: number;
}

export interface CommandReadModelState {
  readonly get: () => OrchestrationReadModel;
  readonly set: (model: OrchestrationReadModel) => void;
}

export const makeCommandTimeoutError = (command: OrchestrationCommand) =>
  new OrchestrationCommandTimeoutError({
    commandId: command.commandId,
    commandType: command.type,
    timeoutMs: ORCHESTRATION_DISPATCH_TIMEOUT_MS,
  });

export const makeCommandInternalError = (
  command: OrchestrationCommand,
  detail = "The orchestration worker crashed before the command could finish.",
) =>
  new OrchestrationCommandInternalError({
    commandId: command.commandId,
    commandType: command.type,
    detail,
  });
