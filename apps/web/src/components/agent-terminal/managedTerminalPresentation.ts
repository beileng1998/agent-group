import { TERMINAL_MAX_WRITE_LENGTH } from "@agent-group/contracts";
import type {
  ProviderKind,
  TerminalAgentEvent,
  TerminalAgentProvider,
  TerminalAgentRuntimeState,
  TerminalAgentSerializedSnapshot,
  ThreadId,
} from "@agent-group/contracts";

const MANAGED_TERMINAL_PROVIDERS = new Set<ProviderKind>(["codex", "claudeAgent", "pi"]);

export function isManagedTerminalProvider(
  provider: ProviderKind | null | undefined,
): provider is TerminalAgentProvider {
  return provider !== null && provider !== undefined && MANAGED_TERMINAL_PROVIDERS.has(provider);
}

export function managedTerminalProviderLabel(provider: TerminalAgentProvider): string {
  switch (provider) {
    case "claudeAgent":
      return "Claude Code";
    case "pi":
      return "Pi";
    default:
      return "Codex";
  }
}

export function managedTerminalStartBlockedReason(input: {
  readonly hasLiveTurn: boolean;
  readonly isConnecting: boolean;
  readonly isSendBusy: boolean;
}): string | null {
  if (input.hasLiveTurn) {
    return "Stop or wait for the current Chat turn before opening Terminal.";
  }
  if (input.isConnecting || input.isSendBusy) {
    return "Wait for Chat to finish starting before opening Terminal.";
  }
  return null;
}

export function managedTerminalStatusLabel(state: TerminalAgentRuntimeState | null): string {
  if (!state) return "Unavailable";
  switch (state.status) {
    case "context-blocked":
      return "Context blocked";
    case "attention":
      return "Needs attention";
    case "checking":
      return "Waiting for session";
    case "starting":
      return "Starting";
    case "ready":
      return "Ready";
    case "running":
      return "Running";
    case "stopping":
      return "Stopping";
    case "stopped":
      return "Stopped";
    case "exited":
      return "Exited";
    case "unsupported":
      return "Unsupported";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

export function isManagedTerminalAuthority(state: TerminalAgentRuntimeState | null): boolean {
  return state?.authority === "terminal";
}

export function canRestartManagedTerminal(state: TerminalAgentRuntimeState | null): boolean {
  return (
    state?.authority === "terminal" &&
    (state.status === "stopped" ||
      state.status === "exited" ||
      state.status === "error" ||
      state.status === "unsupported" ||
      state.status === "context-blocked")
  );
}

export function canSwitchManagedTerminalToChat(state: TerminalAgentRuntimeState | null): boolean {
  return (
    state?.authority === "terminal" && state.status !== "running" && state.status !== "stopping"
  );
}

export function managedTerminalEventThreadId(event: TerminalAgentEvent): ThreadId {
  return event.type === "state" ? event.state.threadId : event.threadId;
}

export function acceptManagedTerminalState(
  current: TerminalAgentRuntimeState | null,
  next: TerminalAgentRuntimeState,
): TerminalAgentRuntimeState {
  if (current?.threadId === next.threadId && current.revision > next.revision) {
    return current;
  }
  return next;
}

export function acceptManagedTerminalRpcState(
  current: TerminalAgentRuntimeState | null,
  next: TerminalAgentRuntimeState,
): TerminalAgentRuntimeState {
  if (current?.threadId === next.threadId && current.revision >= next.revision) {
    return current;
  }
  return next;
}

export function buildManagedTerminalSnapshotAnsi(
  snapshot: TerminalAgentSerializedSnapshot,
): string {
  return (
    snapshot.scrollbackAnsi +
    snapshot.rehydrateSequences +
    snapshot.snapshotAnsi +
    (snapshot.pendingEscapeTailAnsi ?? "")
  );
}

export type ManagedTerminalOutputDecision = "write" | "ignore" | "resync";

export function classifyManagedTerminalOutput(input: {
  readonly attachedRevision: number;
  readonly attachedGeneration: string;
  readonly outputSequence: number;
  readonly revision: number;
  readonly generation: string;
  readonly seq: number;
}): ManagedTerminalOutputDecision {
  if (
    input.revision !== input.attachedRevision ||
    input.generation !== input.attachedGeneration ||
    input.seq <= input.outputSequence
  ) {
    return "ignore";
  }
  return input.seq === input.outputSequence + 1 ? "write" : "resync";
}

export function splitManagedTerminalInput(data: string): readonly string[] {
  if (data.length <= TERMINAL_MAX_WRITE_LENGTH) return data.length > 0 ? [data] : [];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < data.length) {
    let end = Math.min(data.length, offset + TERMINAL_MAX_WRITE_LENGTH);
    const finalCodeUnit = data.charCodeAt(end - 1);
    if (end < data.length && finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
      end -= 1;
    }
    chunks.push(data.slice(offset, end));
    offset = end;
  }
  return chunks;
}
