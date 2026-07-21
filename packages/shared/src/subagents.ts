// FILE: subagents.ts
// Purpose: Stable public entry for shared subagent payload and identity helpers.

export type {
  ParsedSubagentAgentState,
  ParsedSubagentIdentityDirectory,
  ParsedSubagentIdentityHint,
  ParsedSubagentReceiverAgent,
} from "./subagents/types";
export {
  collectSubagentProviderThreadIds,
  decodeSubagentAgentStates,
  decodeSubagentReceiverAgents,
  decodeSubagentReceiverThreadIds,
  normalizeSubagentIdentifier,
} from "./subagents/payloadDecoding";
export {
  buildSubagentIdentityDirectory,
  extractSubagentIdentityHints,
  mergeSubagentIdentityHints,
  resolveSubagentIdentityFromDirectory,
  resolveSubagentIdentityHint,
} from "./subagents/identityDirectory";
