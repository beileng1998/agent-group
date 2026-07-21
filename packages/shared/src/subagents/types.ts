export interface ParsedSubagentReceiverAgent {
  providerThreadId: string;
  agentId?: string | undefined;
  nickname?: string | undefined;
  role?: string | undefined;
  model?: string | undefined;
  prompt?: string | undefined;
  modelIsRequestedHint?: boolean | undefined;
}

export interface ParsedSubagentAgentState {
  threadId: string;
  agentId?: string | undefined;
  nickname?: string | undefined;
  role?: string | undefined;
  model?: string | undefined;
  prompt?: string | undefined;
  status?: string | undefined;
  message?: string | undefined;
}

export interface ParsedSubagentIdentityHint {
  providerThreadId?: string | undefined;
  agentId?: string | undefined;
  nickname?: string | undefined;
  role?: string | undefined;
  model?: string | undefined;
  prompt?: string | undefined;
  status?: string | undefined;
  message?: string | undefined;
  modelIsRequestedHint?: boolean | undefined;
}

export interface ParsedSubagentIdentityDirectory {
  readonly byProviderThreadId: ReadonlyMap<string, ParsedSubagentIdentityHint>;
  readonly byAgentId: ReadonlyMap<string, ParsedSubagentIdentityHint>;
}
