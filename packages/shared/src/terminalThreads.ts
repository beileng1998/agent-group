// FILE: terminalThreads.ts
// Purpose: Stable public entry point for shared terminal identity helpers.
// Layer: Shared terminal metadata utilities

export {
  GENERIC_TERMINAL_THREAD_TITLE,
  isGenericTerminalThreadTitle,
  MANAGED_TERMINAL_COMMAND_NAME_BY_CLI_KIND,
  managedTerminalCommandNameForCliKind,
  AGENT_GROUP_TERMINAL_CLI_KIND_ENV_KEY,
  AGENT_GROUP_TERMINAL_HOOK_OSC_PREFIX,
  defaultTerminalTitleForCliKind,
  terminalCliKindFromValue,
} from "./terminal-threads/terminalIdentity";
export type {
  ManagedTerminalCliKind,
  ResolvedTerminalVisualIdentity,
  TerminalActivityState,
  TerminalAgentHookEventType,
  TerminalCliKind,
  TerminalCommandIdentity,
  TerminalIconKey,
  TerminalVisualState,
} from "./terminal-threads/terminalIdentity";
export {
  deriveTerminalCommandIdentity,
  deriveTerminalProcessIdentity,
  deriveTerminalTitleFromCommand,
  reconcileTerminalCommandIdentity,
} from "./terminal-threads/terminalCommandIdentity";
export {
  consumeTerminalIdentityInput,
  consumeTerminalTitleInput,
} from "./terminal-threads/terminalInputIdentity";
export {
  deriveTerminalOutputIdentity,
  deriveTerminalTitleSignalIdentity,
  resolveTerminalVisualIdentity,
} from "./terminal-threads/terminalVisualIdentity";
