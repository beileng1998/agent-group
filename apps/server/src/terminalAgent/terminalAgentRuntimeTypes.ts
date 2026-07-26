import type {
  ModelSelection,
  RuntimeMode,
  TerminalAgentCapabilitySnapshot,
  TerminalAgentContextSnapshot,
  TerminalAgentProvider,
  ThreadId,
  TurnId,
} from "@agent-group/contracts";

import type { AgentGroupCoordinates } from "../agentGroup/state";
import type { TerminalAgentHookResponse } from "./terminalAgentProtocol";

export type ManagedTerminalModelSelection = Extract<
  ModelSelection,
  { provider: TerminalAgentProvider }
>;

export interface ResolvedTerminalTarget {
  readonly threadId: ThreadId;
  readonly provider: TerminalAgentProvider;
  readonly modelSelection: ManagedTerminalModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly workspaceRoot: string;
  readonly coordinates: AgentGroupCoordinates;
}

export interface ActiveTerminalTurn {
  readonly turnId: TurnId;
  readonly promptEventId: string;
  readonly prompt: string;
  readonly providerTurnId: string | null;
  readonly awarenessHead: string | null;
  deliveredContext: string;
  context: TerminalAgentContextSnapshot;
  readonly tracksAgentGroupContext: boolean;
  pendingPrompt: PendingTerminalPrompt | null;
  readonly acceptedPromptEvents: Map<string, string>;
  accepted: boolean;
}

export interface PendingTerminalPrompt {
  readonly promptEventId: string;
  readonly prompt: string;
  readonly deliveredContext: string;
  readonly context: TerminalAgentContextSnapshot;
}

export interface TerminalAgentRuntimeRecord extends ResolvedTerminalTarget {
  modelSelection: ManagedTerminalModelSelection;
  readonly runtimeInstanceId: string;
  readonly runtimeDir: string;
  revision: number;
  generation: string;
  providerSessionId: string | null;
  capabilities: TerminalAgentCapabilitySnapshot;
  model: string | null;
  effort: string | null;
  permission: string | null;
  context: TerminalAgentContextSnapshot | null;
  activeTurn: ActiveTerminalTurn | null;
  transcriptBootstrap: string | null;
  handshakeReceived: boolean;
  metadataStatePublicationPending: boolean;
  pauseHook: () => Promise<void>;
  resumeHook: () => void;
  unregisterHook: () => void;
  readonly eventResponses: Map<string, TerminalAgentHookResponse>;
}
