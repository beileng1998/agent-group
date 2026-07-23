import { Schema } from "effect";

import { AgentGroupSessionDocument } from "./agentGroup";
import { IsoDateTime } from "./baseSchemas";
import { OrchestrationShellSnapshot, OrchestrationThreadDetailSnapshot } from "./orchestration";

/**
 * Durable browser bootstrap payload. It carries every read needed to render the
 * current conversation without making WebSocket availability a prerequisite.
 */
export const RemoteBootstrapSnapshot = Schema.Struct({
  version: Schema.Literal(1),
  generatedAt: IsoDateTime,
  shell: OrchestrationShellSnapshot,
  thread: Schema.NullOr(OrchestrationThreadDetailSnapshot),
  agentGroupSession: Schema.NullOr(AgentGroupSessionDocument),
});

export type RemoteBootstrapSnapshot = typeof RemoteBootstrapSnapshot.Type;
