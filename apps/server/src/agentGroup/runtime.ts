import { randomUUID } from "node:crypto";

import {
  DEFAULT_SERVER_SETTINGS,
  ThreadId,
  type AgentGroupConfig,
  type AgentGroupOverview,
  type AgentGroupServerSettings,
  type AgentGroupSessionDocument,
  type AgentGroupUpdateConfigInput,
  type AgentGroupUpdateSessionInput,
  type AgentGroupWriteContextInput,
} from "@agent-group/contracts";

import { commitSessionContext, ensureContextRepository, prepareSessionContext } from "./contextGit";
import {
  buildAgentGroupPrompt,
  type AgentGroupPromptAttachment,
  type AgentGroupPromptMentionedSession,
} from "./prompt";
import {
  initializeContextTemplate,
  resolveContextTemplate,
  resolveGlobalSettings,
  toConfig,
  toDocument,
  toSessionState,
} from "./runtimeView";
import {
  type AgentGroupCoordinates,
  type AgentGroupLayout,
  type StoredGroupState,
  type StoredSessionState,
  contextRelativePath,
  contextRevision,
  ensureAgentGroupLayout,
  ensureSession,
  loadOrCreateGroupState,
  readContext,
  withAgentGroupWorkspaceLock,
  writeContext,
  writeGroupState,
} from "./state";

export { isAgentGroupWorkspace } from "./state";

export interface PrepareAgentGroupTurnInput extends AgentGroupCoordinates {
  readonly userText: string;
  readonly attachments?: ReadonlyArray<AgentGroupPromptAttachment>;
  readonly mentionedSessions?: ReadonlyArray<AgentGroupMentionedSession>;
  readonly globalSettings?: AgentGroupServerSettings;
}

export interface AgentGroupMentionedSession {
  readonly sessionId: ThreadId;
  readonly title: string;
  readonly parentSessionId?: ThreadId | null;
  readonly createdAt?: string;
  readonly transcriptPath?: string;
}

export interface PreparedAgentGroupTurn {
  readonly prompt: string;
  readonly contextPath: string;
  readonly awarenessHead: string | null;
}

export interface FinalizeAgentGroupTurnInput extends AgentGroupCoordinates {
  readonly turnId: string | null;
  readonly successful: boolean;
}

const AGENT_GROUP_RUNTIME_ID = randomUUID();

type WriteAgentGroupContextInput = AgentGroupCoordinates &
  GlobalAgentGroupSettings &
  Pick<AgentGroupWriteContextInput, "context" | "expectedRevision">;
type UpdateAgentGroupConfigInput = AgentGroupUpdateConfigInput &
  GlobalAgentGroupSettings & { readonly workspaceRoot: string };
type UpdateAgentGroupSessionInput = AgentGroupCoordinates &
  GlobalAgentGroupSettings &
  Pick<AgentGroupUpdateSessionInput, "contextAwarenessEnabled" | "expectedRevision">;
type GlobalAgentGroupSettings = { readonly globalSettings?: AgentGroupServerSettings };

export async function getAgentGroupConfig(
  input: Pick<AgentGroupCoordinates, "workspaceRoot" | "groupId"> & GlobalAgentGroupSettings,
): Promise<AgentGroupConfig> {
  return withGroup(input, async ({ state }) =>
    toConfig(state, input.groupId, resolveGlobalSettings(input.globalSettings)),
  );
}

export async function getAgentGroupOverview(
  input: Pick<AgentGroupCoordinates, "workspaceRoot" | "groupId"> & GlobalAgentGroupSettings,
): Promise<AgentGroupOverview> {
  return withGroup(input, async ({ state }) => ({
    config: toConfig(state, input.groupId, resolveGlobalSettings(input.globalSettings)),
    sessions: Object.values(state.sessions).map(toSessionState),
  }));
}

export async function getAgentGroupSession(
  input: AgentGroupCoordinates & GlobalAgentGroupSettings,
): Promise<AgentGroupSessionDocument> {
  return withSession(input, async ({ layout, state, session, contextPath, created }) => {
    if (created) {
      await commitSessionContext(
        layout.workspaceRoot,
        session.sessionId,
        "Initialize session context",
      );
    }
    return toDocument(
      layout,
      state,
      session,
      contextPath,
      input.groupId,
      resolveGlobalSettings(input.globalSettings),
    );
  });
}

export async function writeAgentGroupContext(
  input: WriteAgentGroupContextInput,
): Promise<AgentGroupSessionDocument> {
  return withSession(input, async ({ layout, state, session, contextPath }) => {
    const current = await readContext(contextPath);
    if (contextRevision(current) !== input.expectedRevision) {
      throw new Error("Session context changed; reload before saving");
    }
    await writeContext(contextPath, input.context);
    await commitSessionContext(layout.workspaceRoot, session.sessionId, "Save session context");
    return toDocument(
      layout,
      state,
      session,
      contextPath,
      input.groupId,
      resolveGlobalSettings(input.globalSettings),
    );
  });
}

export async function updateAgentGroupConfig(
  input: UpdateAgentGroupConfigInput,
): Promise<AgentGroupConfig> {
  return withAgentGroupWorkspaceLock(input.workspaceRoot, async (canonicalWorkspaceRoot) => {
    const layout = await ensureAgentGroupLayout(canonicalWorkspaceRoot);
    const { state, created } = await loadOrCreateGroupState(layout, input.groupId);
    const globalSettings = resolveGlobalSettings(input.globalSettings);
    const initialized = created && initializeContextTemplate(state, globalSettings);
    assertStateRevision(state, input.expectedRevision);

    let changed = false;
    if (input.contextEnabled !== undefined && input.contextEnabled !== state.contextEnabled) {
      state.contextEnabled = input.contextEnabled;
      changed = true;
    }
    if (
      input.browserToolsEnabled !== undefined &&
      input.browserToolsEnabled !== state.browserToolsEnabled
    ) {
      state.browserToolsEnabled = input.browserToolsEnabled;
      changed = true;
    }
    if (input.globalRules !== undefined && input.globalRules !== state.globalRules) {
      state.globalRules = input.globalRules;
      changed = true;
    }
    if (input.contextTemplateId !== undefined) {
      const template = input.contextTemplateId
        ? globalSettings.contextTemplates.find(
            (candidate) => candidate.id === input.contextTemplateId,
          )
        : undefined;
      if (input.contextTemplateId && !template) {
        throw new Error("Selected context template is unavailable");
      }
      if (state.contextTemplateId !== (input.contextTemplateId ?? null)) {
        state.contextTemplateId = input.contextTemplateId ?? null;
        changed = true;
      }
      if (template && template.content !== state.contextTemplate) {
        state.contextTemplate = template.content;
        changed = true;
      }
    } else if (
      input.contextTemplate !== undefined &&
      input.contextTemplate !== state.contextTemplate
    ) {
      state.contextTemplate = input.contextTemplate;
      state.contextTemplateId =
        globalSettings.contextTemplates.find(
          (template) => template.content === input.contextTemplate,
        )?.id ?? null;
      changed = true;
    }
    if (
      input.contextAwarenessDefaultEnabled !== undefined &&
      input.contextAwarenessDefaultEnabled !== state.contextAwarenessDefaultEnabled
    ) {
      state.contextAwarenessDefaultEnabled = input.contextAwarenessDefaultEnabled;
      changed = true;
    }
    if (changed) {
      state.revision += 1;
    }
    if (changed || initialized) {
      await writeGroupState(layout, state);
    }
    if (created) await ensureContextRepository(layout.workspaceRoot);
    return toConfig(state, input.groupId, globalSettings);
  });
}

export async function updateAgentGroupSession(
  input: UpdateAgentGroupSessionInput,
): Promise<AgentGroupSessionDocument> {
  return withAgentGroupWorkspaceLock(input.workspaceRoot, async (canonicalWorkspaceRoot) => {
    const layout = await ensureAgentGroupLayout(canonicalWorkspaceRoot);
    const { state } = await loadOrCreateGroupState(layout, input.groupId);
    assertStateRevision(state, input.expectedRevision);
    const globalSettings = resolveGlobalSettings(input.globalSettings);
    const ensured = await ensureSession(
      layout,
      state,
      input,
      resolveContextTemplate(state, globalSettings),
    );
    const changed = ensured.session.contextAwarenessEnabled !== input.contextAwarenessEnabled;
    if (changed) {
      ensured.session.contextAwarenessEnabled = input.contextAwarenessEnabled;
      if (!ensured.created) state.revision += 1;
    }
    if (ensured.created || changed) await writeGroupState(layout, state);
    if (ensured.created) {
      await commitSessionContext(
        layout.workspaceRoot,
        ensured.session.sessionId,
        "Initialize session context",
      );
    }
    return toDocument(
      layout,
      state,
      ensured.session,
      ensured.contextPath,
      input.groupId,
      globalSettings,
    );
  });
}

export async function prepareAgentGroupTurn(
  input: PrepareAgentGroupTurnInput,
): Promise<PreparedAgentGroupTurn | null> {
  const globalSettings = input.globalSettings ?? DEFAULT_SERVER_SETTINGS.agentGroup;
  if (!globalSettings.contextEnabled) return null;
  return withSession(input, async ({ layout, state, session }) => {
    const interruptedTurn = hasInterruptedTurn(session);
    const { awareness } = await prepareSessionContext(
      layout.workspaceRoot,
      session.sessionId,
      session.contextAwarenessEnabled,
      session.contextSeenCommit,
    );
    // Commit the latest Context before clearing a marker left by an older
    // server process. A failed Git operation therefore keeps the marker for
    // the next recovery attempt instead of silently discarding it.
    if (interruptedTurn) {
      clearInterruptedTurn(session);
      await writeGroupState(layout, state);
    }
    const mentionedSessions: AgentGroupPromptMentionedSession[] = [];
    let createdMentionedSession = false;
    for (const mentioned of input.mentionedSessions ?? []) {
      if (mentioned.sessionId === session.sessionId) continue;
      const ensured = await ensureSession(
        layout,
        state,
        {
          workspaceRoot: layout.workspaceRoot,
          groupId: input.groupId,
          sessionId: mentioned.sessionId,
          ...(mentioned.parentSessionId !== undefined
            ? { parentSessionId: mentioned.parentSessionId }
            : {}),
          ...(mentioned.createdAt ? { createdAt: mentioned.createdAt } : {}),
        },
        resolveContextTemplate(state, globalSettings),
      );
      createdMentionedSession ||= ensured.created;
      mentionedSessions.push({
        sessionId: ensured.session.sessionId,
        title: mentioned.title,
        contextPath: ensured.contextRelativePath,
        ...(mentioned.transcriptPath ? { transcriptPath: mentioned.transcriptPath } : {}),
      });
    }
    if (createdMentionedSession) await writeGroupState(layout, state);
    const awarenessCommand =
      awareness && awareness.base !== awareness.head ? awareness.command : undefined;
    const firstTurn = !session.firstTurnCompleted;
    return {
      prompt: buildAgentGroupPrompt({
        userText: input.userText,
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        contextPath: contextRelativePath(session.sessionId),
        ...(firstTurn && session.parentSessionId
          ? { parentContextPath: contextRelativePath(session.parentSessionId) }
          : {}),
        ...(awarenessCommand ? { contextAwarenessCommand: awarenessCommand } : {}),
        ...(mentionedSessions.length > 0 ? { mentionedSessions } : {}),
        ...(state.browserToolsEnabled ? { browserSessionId: session.sessionId } : {}),
        firstTurn,
        globalRules: globalSettings.globalRules,
        groupRules: state.globalRules,
        promptInstructions: globalSettings.promptInstructions,
      }),
      contextPath: contextRelativePath(session.sessionId),
      awarenessHead: awareness?.head ?? null,
    };
  });
}

export async function markAgentGroupTurnStarted(
  input: AgentGroupCoordinates,
  turnId: string,
  awarenessHead: string | null,
): Promise<void> {
  await withSession(input, async ({ layout, state, session }) => {
    let changed = false;
    if (session.activeContextTurnId !== turnId) {
      session.activeContextTurnId = turnId;
      changed = true;
    }
    if (session.activeContextRuntimeId !== AGENT_GROUP_RUNTIME_ID) {
      session.activeContextRuntimeId = AGENT_GROUP_RUNTIME_ID;
      changed = true;
    }
    if (session.activeContextAwarenessHead !== awarenessHead) {
      session.activeContextAwarenessHead = awarenessHead;
      changed = true;
    }
    if (changed) await writeGroupState(layout, state);
  });
}

export async function finalizeAgentGroupTurn(
  input: FinalizeAgentGroupTurnInput,
): Promise<string | null> {
  return withGroup(input, async ({ layout, state }) => {
    const session = state.sessions[input.sessionId];
    if (!session || !ownsFinalizableTurn(session, input.turnId)) return null;
    const commit = await commitSessionContext(layout.workspaceRoot, session.sessionId);
    const awarenessHead = session.activeContextAwarenessHead;
    session.activeContextTurnId = null;
    session.activeContextAwarenessHead = null;
    session.activeContextRuntimeId = null;
    let metadataChanged = false;
    if (awarenessHead && session.contextSeenCommit !== awarenessHead) {
      session.contextSeenCommit = awarenessHead;
      metadataChanged = true;
    }
    if (input.successful && !session.firstTurnCompleted) {
      session.firstTurnCompleted = true;
      metadataChanged = true;
    }
    if (metadataChanged) {
      state.revision += 1;
    }
    await writeGroupState(layout, state);
    return commit;
  });
}

function hasInterruptedTurn(session: StoredSessionState): boolean {
  const hasActiveTurn = session.activeContextTurnId !== null;
  const belongsToCurrentRuntime = session.activeContextRuntimeId === AGENT_GROUP_RUNTIME_ID;
  if (hasActiveTurn) return !belongsToCurrentRuntime;
  return session.activeContextAwarenessHead !== null || session.activeContextRuntimeId !== null;
}

function clearInterruptedTurn(session: StoredSessionState): void {
  session.activeContextTurnId = null;
  session.activeContextAwarenessHead = null;
  session.activeContextRuntimeId = null;
}

function ownsFinalizableTurn(session: StoredSessionState, turnId: string | null): boolean {
  if (turnId !== null) return session.activeContextTurnId === turnId;
  return (
    session.activeContextTurnId !== null &&
    session.activeContextRuntimeId !== AGENT_GROUP_RUNTIME_ID
  );
}

interface SessionAccess {
  readonly layout: AgentGroupLayout;
  readonly state: StoredGroupState;
  readonly session: StoredSessionState;
  readonly contextPath: string;
  readonly created: boolean;
}

interface GroupAccess {
  readonly layout: AgentGroupLayout;
  readonly state: StoredGroupState;
}

async function withGroup<T>(
  input: Pick<AgentGroupCoordinates, "workspaceRoot" | "groupId"> & GlobalAgentGroupSettings,
  operation: (access: GroupAccess) => Promise<T>,
): Promise<T> {
  return withAgentGroupWorkspaceLock(input.workspaceRoot, async (canonicalWorkspaceRoot) => {
    const layout = await ensureAgentGroupLayout(canonicalWorkspaceRoot);
    const { state, created } = await loadOrCreateGroupState(layout, input.groupId);
    if (created && initializeContextTemplate(state, resolveGlobalSettings(input.globalSettings))) {
      await writeGroupState(layout, state);
    }
    return operation({ layout, state });
  });
}

function withSession<T>(
  input: AgentGroupCoordinates & GlobalAgentGroupSettings,
  operation: (access: SessionAccess) => Promise<T>,
): Promise<T>;
async function withSession<T>(
  input: AgentGroupCoordinates & GlobalAgentGroupSettings,
  operation: (access: SessionAccess) => Promise<T>,
): Promise<T> {
  return withGroup(input, async ({ layout, state }) => {
    const ensured = await ensureSession(
      layout,
      state,
      input,
      resolveContextTemplate(state, resolveGlobalSettings(input.globalSettings)),
    );
    if (ensured.created) await writeGroupState(layout, state);
    return operation({
      layout,
      state,
      session: ensured.session,
      contextPath: ensured.contextPath,
      created: ensured.created,
    });
  });
}

function assertStateRevision(state: StoredGroupState, expected: number): void {
  if (state.revision !== expected) {
    throw new Error("Agent Group settings changed; reload before saving");
  }
}
