import type {
  TerminalAgentEvent,
  TerminalAgentRuntimeState,
  TerminalAgentStartInput,
  TerminalAgentWriteInput,
  TerminalAgentResizeInput,
  TerminalAgentSubscriptionMode,
  ThreadId,
} from "@agent-group/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

export class TerminalAgentServiceError extends Schema.TaggedErrorClass<TerminalAgentServiceError>()(
  "TerminalAgentServiceError",
  {
    reason: Schema.Literals([
      "disabled",
      "thread-not-found",
      "unsupported-provider",
      "invalid-state",
      "probe-failed",
      "launch-failed",
      "bridge-failed",
      "adapter",
      "stale-runtime",
      "context-failed",
      "projection-failed",
    ]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface TerminalAgentServiceShape {
  readonly get: (
    threadId: ThreadId,
  ) => Effect.Effect<TerminalAgentRuntimeState, TerminalAgentServiceError>;
  readonly start: (
    input: TerminalAgentStartInput,
  ) => Effect.Effect<TerminalAgentRuntimeState, TerminalAgentServiceError>;
  readonly restart: (
    input: TerminalAgentStartInput,
  ) => Effect.Effect<TerminalAgentRuntimeState, TerminalAgentServiceError>;
  readonly switchToChat: (
    threadId: ThreadId,
  ) => Effect.Effect<TerminalAgentRuntimeState, TerminalAgentServiceError>;
  /**
   * Atomically stop whichever execution adapter owns the Thread. The
   * structured callback is invoked only while structured authority is still
   * held under the coordinator transition lock.
   */
  readonly stopCurrentAdapter: (
    threadId: ThreadId,
    stopStructured: () => Effect.Effect<void, unknown>,
  ) => Effect.Effect<"structured" | "terminal", TerminalAgentServiceError>;
  readonly write: (
    input: TerminalAgentWriteInput,
  ) => Effect.Effect<void, TerminalAgentServiceError>;
  readonly resize: (
    input: TerminalAgentResizeInput,
  ) => Effect.Effect<void, TerminalAgentServiceError>;
  readonly subscribe: (
    threadId: ThreadId,
    mode?: TerminalAgentSubscriptionMode,
  ) => Stream.Stream<TerminalAgentEvent, TerminalAgentServiceError>;
  /** Internal deletion boundary: settle the Turn before the Thread is purged. */
  readonly teardownThread: (threadId: ThreadId) => Effect.Effect<void, TerminalAgentServiceError>;
  /** Reconcile durable terminal authority after the server runtime starts. */
  readonly recover: Effect.Effect<void>;
}

export class TerminalAgentService extends ServiceMap.Service<
  TerminalAgentService,
  TerminalAgentServiceShape
>()("agent-group/terminalAgent/Services/TerminalAgentService") {}
