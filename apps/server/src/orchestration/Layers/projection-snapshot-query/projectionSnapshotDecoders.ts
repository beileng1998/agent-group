import {
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationThread,
  OrchestrationThreadDetailSnapshot,
} from "@agent-group/contracts";
import { Schema } from "effect";

export const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
export const decodeShellSnapshot = Schema.decodeUnknownEffect(OrchestrationShellSnapshot);
export const decodeThreadDetail = Schema.decodeUnknownEffect(OrchestrationThread);
export const decodeThreadDetailSnapshot = Schema.decodeUnknownEffect(
  OrchestrationThreadDetailSnapshot,
);
