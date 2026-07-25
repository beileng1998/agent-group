import type {
  TerminalAgentCapabilitySnapshot as ContractTerminalAgentCapabilitySnapshot,
  TerminalAgentProvider,
} from "@agent-group/contracts";

export const MANAGED_TERMINAL_PROVIDERS = [
  "codex",
  "claudeAgent",
  "pi",
] as const satisfies ReadonlyArray<TerminalAgentProvider>;

export type ManagedTerminalProvider = TerminalAgentProvider;

export interface ManagedTerminalProviderDescriptor {
  readonly provider: ManagedTerminalProvider;
  readonly label: "Codex" | "Claude" | "Pi";
  readonly cliKind: "codex" | "claude" | "pi";
  readonly executable: "codex" | "claude" | "pi";
}

const PROVIDER_DESCRIPTORS: Record<
  ManagedTerminalProvider,
  ManagedTerminalProviderDescriptor
> = {
  codex: {
    provider: "codex",
    label: "Codex",
    cliKind: "codex",
    executable: "codex",
  },
  claudeAgent: {
    provider: "claudeAgent",
    label: "Claude",
    cliKind: "claude",
    executable: "claude",
  },
  pi: {
    provider: "pi",
    label: "Pi",
    cliKind: "pi",
    executable: "pi",
  },
};

export function managedTerminalProviderDescriptor(
  provider: ManagedTerminalProvider,
): ManagedTerminalProviderDescriptor {
  return PROVIDER_DESCRIPTORS[provider];
}

export type TerminalAgentCapabilitySnapshot =
  ContractTerminalAgentCapabilitySnapshot;

export interface TerminalAgentRuntimeModel {
  readonly model?: string;
  readonly effort?: string;
  readonly permissionMode?: string;
}

interface TerminalAgentEventBase {
  readonly eventId?: string;
}

export type TerminalAgentEvent =
  | (TerminalAgentEventBase &
      TerminalAgentRuntimeModel & {
        readonly type: "session_start";
        readonly providerSessionId: string;
        readonly reason: string;
      })
  | (TerminalAgentEventBase &
      TerminalAgentRuntimeModel & {
        readonly type: "prompt_submit";
        readonly prompt: string;
        readonly providerTurnId?: string;
      })
  | (TerminalAgentEventBase & {
      readonly type: "subagent_start";
      readonly providerTurnId?: string;
      readonly agentId?: string;
    })
  | (TerminalAgentEventBase & {
      readonly type: "turn_stop";
      readonly providerTurnId?: string;
      readonly assistantText?: string;
      readonly hasBackgroundWork?: boolean;
    })
  | (TerminalAgentEventBase & {
      readonly type: "turn_failure";
      readonly providerTurnId?: string;
      readonly message: string;
    })
  | (TerminalAgentEventBase &
      TerminalAgentRuntimeModel & {
        readonly type: "runtime_state";
      })
  | (TerminalAgentEventBase & {
      readonly type: "session_end";
      readonly reason?: string;
    })
  | (TerminalAgentEventBase & {
      readonly type: "session_compact";
      readonly reason: string;
      readonly willRetry: boolean;
    })
  | (TerminalAgentEventBase & {
      readonly type: "unmanaged_input";
      readonly message: string;
    });

export interface TerminalAgentHookResponse {
  readonly turnId?: string;
  readonly additionalContext?: string;
  readonly block?: { readonly message: string };
  readonly statusLine?: string;
}

export interface TerminalAgentBridgeRequest {
  readonly runtimeInstanceId: string;
  readonly input: unknown;
  readonly eventId?: string;
  readonly mode?: string;
}

export interface TerminalAgentDriverLaunch {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Record<string, string>;
  readonly runtimeDir: string;
}

export interface TerminalAgentProviderRuntime {
  readonly provider: ManagedTerminalProvider;
  readonly cliKind: "codex" | "claude" | "pi";
}
