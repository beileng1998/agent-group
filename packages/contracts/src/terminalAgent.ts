import { Schema } from "effect";

import {
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import {
  TerminalColsSchema,
  TerminalRowsSchema,
  TerminalWriteDataSchema,
} from "./terminal";

const StrictRequest = {
  parseOptions: { onExcessProperty: "error" },
} as const;

const BoundedRuntimeId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
const BoundedProviderValue = TrimmedNonEmptyString.check(Schema.isMaxLength(512));

/** Hard UTF-8 budget for the ANSI payload restored into a managed xterm view. */
export const TERMINAL_AGENT_SNAPSHOT_MAX_BYTES = 1024 * 1024;

/**
 * Managed terminals are an execution surface for these providers, not a new
 * ProviderKind. The server derives the provider from the Thread; requests never
 * select a provider or supply a process command.
 */
export const TerminalAgentProvider = Schema.Literals(["codex", "claudeAgent", "pi"]);
export type TerminalAgentProvider = typeof TerminalAgentProvider.Type;

export const TerminalAgentAuthority = Schema.Literals(["structured", "terminal"]);
export type TerminalAgentAuthority = typeof TerminalAgentAuthority.Type;

export const TerminalAgentRuntimeStatus = Schema.Literals([
  "idle",
  "checking",
  "starting",
  "ready",
  "running",
  "attention",
  "context-blocked",
  "stopping",
  "stopped",
  "exited",
  "error",
  "unsupported",
]);
export type TerminalAgentRuntimeStatus = typeof TerminalAgentRuntimeStatus.Type;

export const TerminalAgentCapabilitySnapshot = Schema.Struct({
  cliVersion: BoundedProviderValue,
  authentication: Schema.Literal("authenticated"),
  authMethod: Schema.NullOr(BoundedProviderValue),
  apiProvider: Schema.NullOr(BoundedProviderValue),
  hookSchema: Schema.Literals(["cli-verified", "handshake-verified"]),
});
export type TerminalAgentCapabilitySnapshot =
  typeof TerminalAgentCapabilitySnapshot.Type;

export const TerminalAgentContextSource = Schema.Struct({
  label: BoundedProviderValue,
  path: Schema.NullOr(TrimmedNonEmptyString),
});
export type TerminalAgentContextSource = typeof TerminalAgentContextSource.Type;

export const TerminalAgentContextSnapshot = Schema.Struct({
  turnId: BoundedRuntimeId,
  checksum: BoundedRuntimeId,
  delivery: Schema.Literals(["inline", "file-reference"]),
  filePath: Schema.NullOr(TrimmedNonEmptyString),
  content: Schema.String,
  sources: Schema.Array(TerminalAgentContextSource).check(Schema.isMaxLength(64)),
  createdAt: TrimmedNonEmptyString,
});
export type TerminalAgentContextSnapshot = typeof TerminalAgentContextSnapshot.Type;

export const TerminalAgentExit = Schema.Struct({
  code: Schema.NullOr(Schema.Int),
  signal: Schema.NullOr(Schema.Int),
});
export type TerminalAgentExit = typeof TerminalAgentExit.Type;

/**
 * `revision` is the per-Thread authority fence and increases monotonically.
 * Runtime identity is nullable while the structured adapter owns the Thread.
 */
export const TerminalAgentRuntimeState = Schema.Struct({
  threadId: ThreadId,
  authority: TerminalAgentAuthority,
  revision: NonNegativeInt,
  provider: TerminalAgentProvider,
  status: TerminalAgentRuntimeStatus,
  runtimeInstanceId: Schema.NullOr(BoundedRuntimeId),
  generation: Schema.NullOr(BoundedRuntimeId),
  pid: Schema.NullOr(PositiveInt),
  providerSessionId: Schema.NullOr(BoundedProviderValue),
  model: Schema.NullOr(BoundedProviderValue),
  effort: Schema.NullOr(BoundedProviderValue),
  permission: Schema.NullOr(BoundedProviderValue),
  capabilities: Schema.NullOr(TerminalAgentCapabilitySnapshot),
  exit: Schema.NullOr(TerminalAgentExit),
  error: Schema.NullOr(TrimmedNonEmptyString),
});
export type TerminalAgentRuntimeState = typeof TerminalAgentRuntimeState.Type;

/** Internal fence copied onto terminal-originated runtime projection work. */
export const TerminalAgentRuntimeFence = Schema.Struct({
  revision: NonNegativeInt,
  generation: BoundedRuntimeId,
});
export type TerminalAgentRuntimeFence = typeof TerminalAgentRuntimeFence.Type;

export const TerminalAgentThreadInput = Schema.Struct({
  threadId: ThreadId,
}).annotate(StrictRequest);
export type TerminalAgentThreadInput = Schema.Codec.Encoded<typeof TerminalAgentThreadInput>;

export const TerminalAgentStartInput = Schema.Struct({
  threadId: ThreadId,
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
}).annotate(StrictRequest);
export type TerminalAgentStartInput = Schema.Codec.Encoded<typeof TerminalAgentStartInput>;

export const TerminalAgentRestartInput = TerminalAgentStartInput;
export type TerminalAgentRestartInput = Schema.Codec.Encoded<typeof TerminalAgentRestartInput>;

export const TerminalAgentWriteInput = Schema.Struct({
  threadId: ThreadId,
  revision: NonNegativeInt,
  generation: BoundedRuntimeId,
  data: TerminalWriteDataSchema,
}).annotate(StrictRequest);
export type TerminalAgentWriteInput = Schema.Codec.Encoded<typeof TerminalAgentWriteInput>;

export const TerminalAgentResizeInput = Schema.Struct({
  threadId: ThreadId,
  revision: NonNegativeInt,
  generation: BoundedRuntimeId,
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
}).annotate(StrictRequest);
export type TerminalAgentResizeInput = Schema.Codec.Encoded<typeof TerminalAgentResizeInput>;

export const TerminalAgentGetInput = TerminalAgentThreadInput;
export type TerminalAgentGetInput = Schema.Codec.Encoded<typeof TerminalAgentGetInput>;

export const TerminalAgentSwitchToChatInput = TerminalAgentThreadInput;
export type TerminalAgentSwitchToChatInput = Schema.Codec.Encoded<
  typeof TerminalAgentSwitchToChatInput
>;

export const TerminalAgentSubscriptionMode = Schema.Literals([
  "state",
  "terminal",
]);
export type TerminalAgentSubscriptionMode =
  typeof TerminalAgentSubscriptionMode.Type;

export const TerminalAgentSubscribeInput = Schema.Struct({
  threadId: ThreadId,
  mode: Schema.optional(TerminalAgentSubscriptionMode),
}).annotate(StrictRequest);
export type TerminalAgentSubscribeInput = Schema.Codec.Encoded<
  typeof TerminalAgentSubscribeInput
>;

export const TerminalAgentSerializedSnapshot = Schema.Struct({
  snapshotAnsi: Schema.String,
  scrollbackAnsi: Schema.String,
  rehydrateSequences: Schema.String,
  pendingEscapeTailAnsi: Schema.optional(Schema.String),
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
  outputSequence: NonNegativeInt,
});
export type TerminalAgentSerializedSnapshot = typeof TerminalAgentSerializedSnapshot.Type;

const TerminalAgentEventBase = Schema.Struct({
  threadId: ThreadId,
  revision: NonNegativeInt,
});

export const TerminalAgentStateEvent = Schema.Struct({
  type: Schema.Literal("state"),
  state: TerminalAgentRuntimeState,
});
export type TerminalAgentStateEvent = typeof TerminalAgentStateEvent.Type;

export const TerminalAgentAttachedEvent = Schema.Struct({
  ...TerminalAgentEventBase.fields,
  type: Schema.Literal("attached"),
  generation: BoundedRuntimeId,
  snapshot: TerminalAgentSerializedSnapshot,
});
export type TerminalAgentAttachedEvent = typeof TerminalAgentAttachedEvent.Type;

export const TerminalAgentOutputEvent = Schema.Struct({
  ...TerminalAgentEventBase.fields,
  type: Schema.Literal("output"),
  generation: BoundedRuntimeId,
  seq: NonNegativeInt,
  data: Schema.String,
});
export type TerminalAgentOutputEvent = typeof TerminalAgentOutputEvent.Type;

export const TerminalAgentExitedEvent = Schema.Struct({
  ...TerminalAgentEventBase.fields,
  type: Schema.Literal("exited"),
  generation: BoundedRuntimeId,
  exit: TerminalAgentExit,
});
export type TerminalAgentExitedEvent = typeof TerminalAgentExitedEvent.Type;

export const TerminalAgentErrorEvent = Schema.Struct({
  ...TerminalAgentEventBase.fields,
  type: Schema.Literal("error"),
  generation: Schema.NullOr(BoundedRuntimeId),
  message: TrimmedNonEmptyString,
});
export type TerminalAgentErrorEvent = typeof TerminalAgentErrorEvent.Type;

/**
 * Subscription ordering is part of the wire contract: an active runtime emits
 * exactly one `attached` snapshot before any `output` item. Consumers restore
 * the xterm payload, ignore seq <= outputSequence, accept only the next
 * sequence, and reconnect for a fresh snapshot on a forward gap.
 */
export const TerminalAgentEvent = Schema.Union([
  TerminalAgentAttachedEvent,
  TerminalAgentStateEvent,
  TerminalAgentOutputEvent,
  TerminalAgentExitedEvent,
  TerminalAgentErrorEvent,
]);
export type TerminalAgentEvent = typeof TerminalAgentEvent.Type;
