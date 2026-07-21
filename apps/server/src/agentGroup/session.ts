import {
  isAgentGroupSessionThread,
  isRuntimeSubagentThread,
  type AgentGroupThreadCandidate,
} from "@agent-group/shared/agentGroupSessions";

export function isRuntimeSubagent(candidate: AgentGroupThreadCandidate): boolean {
  return isRuntimeSubagentThread(candidate);
}

export function isAgentGroupSession(candidate: AgentGroupThreadCandidate): boolean {
  return isAgentGroupSessionThread(candidate);
}
