import { Schema } from "effect";

import { NonNegativeInt } from "./baseSchemas";
import {
  ClientOrchestrationCommand,
  DispatchResult,
  OrchestrationEvent,
  OrchestrationShellStreamEvent,
} from "./orchestration";

export const RemoteCommandRequest = Schema.Struct({
  command: ClientOrchestrationCommand,
});
export type RemoteCommandRequest = typeof RemoteCommandRequest.Type;

export const RemoteCommandResult = DispatchResult;
export type RemoteCommandResult = typeof RemoteCommandResult.Type;

export const RemoteEventBatch = Schema.Struct({
  version: Schema.Literal(1),
  nextSequence: NonNegativeInt,
  hasMore: Schema.Boolean,
  shellEvents: Schema.Array(OrchestrationShellStreamEvent),
  threadEvents: Schema.Array(OrchestrationEvent),
});
export type RemoteEventBatch = typeof RemoteEventBatch.Type;
