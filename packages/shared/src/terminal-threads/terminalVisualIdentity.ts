import {
  createTerminalCommandIdentity,
  defaultTerminalTitleForCliKind,
  type ResolvedTerminalVisualIdentity,
  type TerminalCliKind,
  type TerminalCommandIdentity,
  type TerminalVisualState,
} from "./terminalIdentity";
import {
  deriveCliKindFromOutputText,
  inferCliKindFromTitle,
  normalizeTextForIdentityDetection,
} from "./terminalIdentityDetection";

// Detect provider identity from CLI banners or other high-confidence visible output.
export function deriveTerminalOutputIdentity(output: string): TerminalCommandIdentity | null {
  const cliKind = deriveCliKindFromOutputText(normalizeTextForIdentityDetection(output));
  return cliKind
    ? createTerminalCommandIdentity(defaultTerminalTitleForCliKind(cliKind), cliKind)
    : null;
}

// Detect provider identity from terminal title signals without trusting the title as a tab name.
export function deriveTerminalTitleSignalIdentity(title: string): TerminalCommandIdentity | null {
  const cliKind = inferCliKindFromTitle(title);
  return cliKind
    ? createTerminalCommandIdentity(defaultTerminalTitleForCliKind(cliKind), cliKind)
    : null;
}

// Resolve terminal label, icon, and activity state from persisted metadata plus runtime status.
export function resolveTerminalVisualIdentity(input: {
  cliKind?: TerminalCliKind | null | undefined;
  fallbackTitle: string;
  isRunning?: boolean | undefined;
  state?: TerminalVisualState | null | undefined;
  title?: string | null | undefined;
}): ResolvedTerminalVisualIdentity {
  const resolvedCliKind =
    input.cliKind === undefined ? inferCliKindFromTitle(input.title) : input.cliKind;
  const title =
    input.title?.trim() ||
    (resolvedCliKind ? defaultTerminalTitleForCliKind(resolvedCliKind) : input.fallbackTitle);
  const cliKind = resolvedCliKind ?? null;
  const state = input.state ?? (input.isRunning ? "running" : "idle");
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
    state,
    title,
  };
}
