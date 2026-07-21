export const GENERIC_TERMINAL_THREAD_TITLE = "New terminal";

export type TerminalCliKind = "codex" | "claude" | "antigravity";
export type TerminalIconKey = "terminal" | "openai" | "claude" | "antigravity";
export type TerminalActivityState = "running" | "attention" | "review";
export type TerminalVisualState = "idle" | TerminalActivityState;
export type TerminalAgentHookEventType = "Start" | "Stop" | "PermissionRequest";
export type ManagedTerminalCliKind = Exclude<TerminalCliKind, "antigravity">;

export const AGENT_GROUP_TERMINAL_CLI_KIND_ENV_KEY = "AGENT_GROUP_TERMINAL_CLI_KIND";
export const AGENT_GROUP_TERMINAL_HOOK_OSC_PREFIX = "633;AGENT_GROUP_AGENT_EVENT=";

export const MANAGED_TERMINAL_COMMAND_NAME_BY_CLI_KIND: Record<ManagedTerminalCliKind, string> = {
  codex: "codex",
  claude: "claude",
};

export interface TerminalCommandIdentity {
  cliKind: TerminalCliKind | null;
  iconKey: TerminalIconKey;
  title: string;
}

export interface ResolvedTerminalVisualIdentity extends TerminalCommandIdentity {
  state: TerminalVisualState;
}

export function createTerminalCommandIdentity(
  title: string,
  cliKind: TerminalCliKind | null,
): TerminalCommandIdentity {
  return {
    cliKind,
    iconKey:
      cliKind === "codex"
        ? "openai"
        : cliKind === "claude"
          ? "claude"
          : cliKind === "antigravity"
            ? "antigravity"
            : "terminal",
    title,
  };
}

export function defaultTerminalTitleForCliKind(cliKind: TerminalCliKind): string {
  return cliKind === "codex"
    ? "Codex CLI"
    : cliKind === "claude"
      ? "Claude Code"
      : "Antigravity CLI";
}

export function managedTerminalCommandNameForCliKind(cliKind: ManagedTerminalCliKind): string {
  return MANAGED_TERMINAL_COMMAND_NAME_BY_CLI_KIND[cliKind];
}

export function terminalCliKindFromValue(value: string | null | undefined): TerminalCliKind | null {
  const normalizedValue = value?.trim().toLowerCase();
  return normalizedValue === "codex" ||
    normalizedValue === "claude" ||
    normalizedValue === "antigravity"
    ? normalizedValue
    : null;
}

export function isGenericTerminalThreadTitle(title: string | null | undefined): boolean {
  return (title ?? "").trim() === GENERIC_TERMINAL_THREAD_TITLE;
}
