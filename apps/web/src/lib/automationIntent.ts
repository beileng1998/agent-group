// FILE: automationIntent.ts
// Purpose: Compatibility facade for chat automation intent parsing and resolution.

export type {
  ChatAutomationExecutionScope,
  ChatAutomationIntent,
  ResolvedChatAutomationIntent,
} from "./automation-intent/types";
export {
  ensureAutomationConversationScaffold,
  extractChatAutomationInvocation,
  extractPlainChatAutomationCreationInvocation,
} from "./automation-intent/invocation";
export { detectChatAutomationExecutionScope } from "./automation-intent/clauses";
export { formatAutomationIntentCadence } from "./automation-intent/schedule";
export { deriveAutomationIntentName } from "./automation-intent/prompt";
export {
  parseChatAutomationIntent,
  parseChatAutomationInvocation,
  parsePlainChatAutomationInvocation,
} from "./automation-intent/deterministic";
export {
  resolveChatAutomationIntent,
  shouldGenerateAutomationIntent,
} from "./automation-intent/resolution";
