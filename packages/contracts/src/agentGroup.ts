import { Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";

const ContextText = Schema.String.check(Schema.isMaxLength(1_048_576));
const PromptInstructionText = Schema.String.check(Schema.isMaxLength(16_384));
const ContextRevision = TrimmedNonEmptyString.check(Schema.isMaxLength(128));

export const AgentGroupContextTemplateId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
);
export type AgentGroupContextTemplateId = typeof AgentGroupContextTemplateId.Type;

export const AgentGroupContextTemplate = Schema.Struct({
  id: AgentGroupContextTemplateId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  description: Schema.String.check(Schema.isMaxLength(240)),
  content: ContextText,
});
export type AgentGroupContextTemplate = typeof AgentGroupContextTemplate.Type;

export const DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS = {
  sessionContextFirstTurn: "Proactively maintain this file as the current Session context.",
  sessionContextLaterTurn: "Proactively maintain this file as the current Session context.",
  parentContext: "Reference context from the parent Session.",
  mentionedSessions: "Reference context from Sessions mentioned by the user.",
  contextChanges:
    "Before working, run this command and incorporate relevant Context changes from other Sessions.",
  browserTools: "Browser tools for this Session:",
} as const;

export const AgentGroupPromptInstructions = Schema.Struct({
  sessionContextFirstTurn: PromptInstructionText.pipe(
    Schema.withDecodingDefault(
      () => DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS.sessionContextFirstTurn,
    ),
  ),
  sessionContextLaterTurn: PromptInstructionText.pipe(
    Schema.withDecodingDefault(
      () => DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS.sessionContextLaterTurn,
    ),
  ),
  parentContext: PromptInstructionText.pipe(
    Schema.withDecodingDefault(() => DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS.parentContext),
  ),
  mentionedSessions: PromptInstructionText.pipe(
    Schema.withDecodingDefault(() => DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS.mentionedSessions),
  ),
  contextChanges: PromptInstructionText.pipe(
    Schema.withDecodingDefault(() => DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS.contextChanges),
  ),
  browserTools: PromptInstructionText.pipe(
    Schema.withDecodingDefault(() => DEFAULT_AGENT_GROUP_PROMPT_INSTRUCTIONS.browserTools),
  ),
});
export type AgentGroupPromptInstructions = typeof AgentGroupPromptInstructions.Type;

export const AgentGroupSessionSelector = Schema.Struct({
  sessionId: ThreadId,
});
export type AgentGroupSessionSelector = typeof AgentGroupSessionSelector.Type;

export const AgentGroupConfigSelector = Schema.Struct({
  groupId: ProjectId,
});
export type AgentGroupConfigSelector = typeof AgentGroupConfigSelector.Type;

export const AgentGroupConfig = Schema.Struct({
  groupId: ProjectId,
  contextEnabled: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => true)),
  browserToolsEnabled: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(() => false),
  ),
  globalRules: ContextText,
  contextTemplate: ContextText,
  contextTemplateId: Schema.NullOr(AgentGroupContextTemplateId).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  contextAwarenessDefaultEnabled: Schema.Boolean.pipe(
    Schema.withDecodingDefault(() => false),
  ),
  revision: NonNegativeInt,
});
export type AgentGroupConfig = typeof AgentGroupConfig.Type;

export const AgentGroupSessionState = Schema.Struct({
  sessionId: ThreadId,
  parentSessionId: Schema.NullOr(ThreadId),
  createdAt: IsoDateTime,
  firstTurnCompleted: Schema.Boolean,
  contextAwarenessEnabled: Schema.Boolean,
  contextSeenCommit: Schema.NullOr(Schema.String),
});
export type AgentGroupSessionState = typeof AgentGroupSessionState.Type;

export const AgentGroupSessionDocument = Schema.Struct({
  workspaceRoot: TrimmedNonEmptyString,
  contextPath: TrimmedNonEmptyString,
  context: ContextText,
  contextRevision: ContextRevision,
  config: AgentGroupConfig,
  session: AgentGroupSessionState,
});
export type AgentGroupSessionDocument = typeof AgentGroupSessionDocument.Type;

export const AgentGroupOverview = Schema.Struct({
  config: AgentGroupConfig,
  sessions: Schema.Array(AgentGroupSessionState),
});
export type AgentGroupOverview = typeof AgentGroupOverview.Type;

export const AgentGroupGetSessionInput = AgentGroupSessionSelector;
export type AgentGroupGetSessionInput = typeof AgentGroupGetSessionInput.Type;

export const AgentGroupGetConfigInput = AgentGroupConfigSelector;
export type AgentGroupGetConfigInput = typeof AgentGroupGetConfigInput.Type;

export const AgentGroupGetOverviewInput = AgentGroupConfigSelector;
export type AgentGroupGetOverviewInput = typeof AgentGroupGetOverviewInput.Type;

export const AgentGroupWriteContextInput = Schema.Struct({
  ...AgentGroupSessionSelector.fields,
  context: ContextText,
  expectedRevision: ContextRevision,
});
export type AgentGroupWriteContextInput = typeof AgentGroupWriteContextInput.Type;

export const AgentGroupUpdateConfigInput = Schema.Struct({
  groupId: ProjectId,
  contextEnabled: Schema.optional(Schema.Boolean),
  browserToolsEnabled: Schema.optional(Schema.Boolean),
  globalRules: Schema.optional(ContextText),
  contextTemplate: Schema.optional(ContextText),
  contextTemplateId: Schema.optional(Schema.NullOr(AgentGroupContextTemplateId)),
  contextAwarenessDefaultEnabled: Schema.optional(Schema.Boolean),
  expectedRevision: NonNegativeInt,
});
export type AgentGroupUpdateConfigInput = typeof AgentGroupUpdateConfigInput.Type;

export const AgentGroupUpdateSessionInput = Schema.Struct({
  ...AgentGroupSessionSelector.fields,
  contextAwarenessEnabled: Schema.Boolean,
  expectedRevision: NonNegativeInt,
});
export type AgentGroupUpdateSessionInput = typeof AgentGroupUpdateSessionInput.Type;
