import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ThreadId,
  type AgentGroupConfig,
  type AgentGroupServerSettings,
  type AgentGroupSessionDocument,
} from "@agent-group/contracts";

import {
  type AgentGroupLayout,
  type StoredGroupState,
  type StoredSessionState,
  contextRelativePath,
  contextRevision,
  readContext,
} from "./state";

export function resolveGlobalSettings(
  settings: AgentGroupServerSettings | undefined,
): AgentGroupServerSettings {
  return settings ?? DEFAULT_SERVER_SETTINGS.agentGroup;
}

export function resolveContextTemplate(
  state: StoredGroupState,
  globalSettings: AgentGroupServerSettings,
): string {
  if (!state.contextTemplateId) return state.contextTemplate;
  return (
    globalSettings.contextTemplates.find((template) => template.id === state.contextTemplateId)
      ?.content ?? state.contextTemplate
  );
}

export function initializeContextTemplate(
  state: StoredGroupState,
  globalSettings: AgentGroupServerSettings,
): boolean {
  if (
    state.contextTemplateId &&
    globalSettings.contextTemplates.some((template) => template.id === state.contextTemplateId)
  ) {
    return false;
  }
  const fallback = globalSettings.contextTemplates[0];
  if (!fallback) return false;
  state.contextTemplateId = fallback.id;
  state.contextTemplate = fallback.content;
  return true;
}

export function toSessionState(session: StoredSessionState): AgentGroupSessionDocument["session"] {
  return {
    sessionId: ThreadId.makeUnsafe(session.sessionId),
    parentSessionId: session.parentSessionId ? ThreadId.makeUnsafe(session.parentSessionId) : null,
    createdAt: session.createdAt,
    firstTurnCompleted: session.firstTurnCompleted,
    contextAwarenessEnabled: session.contextAwarenessEnabled,
    contextSeenCommit: session.contextSeenCommit,
  };
}

export function toConfig(
  state: StoredGroupState,
  groupId: string,
  globalSettings: AgentGroupServerSettings,
): AgentGroupConfig {
  return {
    groupId: ProjectId.makeUnsafe(groupId),
    contextEnabled: state.contextEnabled,
    browserToolsEnabled: state.browserToolsEnabled,
    globalRules: state.globalRules,
    contextTemplate: resolveContextTemplate(state, globalSettings),
    contextTemplateId: state.contextTemplateId,
    contextAwarenessDefaultEnabled: state.contextAwarenessDefaultEnabled,
    revision: state.revision,
  };
}

export async function toDocument(
  layout: AgentGroupLayout,
  state: StoredGroupState,
  session: StoredSessionState,
  contextPath: string,
  groupId: string,
  globalSettings: AgentGroupServerSettings,
): Promise<AgentGroupSessionDocument> {
  const context = await readContext(contextPath);
  return {
    workspaceRoot: layout.workspaceRoot,
    contextPath: contextRelativePath(session.sessionId),
    context,
    contextRevision: contextRevision(context),
    config: toConfig(state, groupId, globalSettings),
    session: toSessionState(session),
  };
}
