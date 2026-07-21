import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CONTEXT_TEMPLATE_PRESETS,
  DEFAULT_CONTEXT_TEMPLATE,
} from "@agent-group/shared/contextTemplates";

import {
  assertAgentGroupEntityId,
  canonicalDirectory,
  createCanonicalDirectoryQueue,
  ensureRealDirectory,
  existingPathState,
  isNodeError,
} from "./filesystem";

const MAX_CONTEXT_BYTES = 1024 * 1024;
const MAX_STATE_BYTES = 4 * 1024 * 1024;

export interface AgentGroupCoordinates {
  readonly workspaceRoot: string;
  readonly groupId: string;
  readonly sessionId: string;
  readonly parentSessionId?: string | null;
  readonly createdAt?: string;
}

export interface StoredSessionState {
  sessionId: string;
  parentSessionId: string | null;
  createdAt: string;
  firstTurnCompleted: boolean;
  contextAwarenessEnabled: boolean;
  contextSeenCommit: string | null;
  activeContextTurnId: string | null;
  activeContextAwarenessHead: string | null;
  activeContextRuntimeId: string | null;
}

export interface StoredGroupState {
  version: 1;
  /** Group that first initialized this portable workspace state. */
  groupId: string;
  revision: number;
  contextEnabled: boolean;
  browserToolsEnabled: boolean;
  globalRules: string;
  contextTemplate: string;
  contextTemplateId: string | null;
  contextAwarenessDefaultEnabled: boolean;
  sessions: Record<string, StoredSessionState>;
}

export interface AgentGroupLayout {
  readonly workspaceRoot: string;
  readonly agentGroupDirectory: string;
  readonly sessionsDirectory: string;
  readonly statePath: string;
}

export interface EnsuredSession {
  readonly session: StoredSessionState;
  readonly created: boolean;
  readonly contextPath: string;
  readonly contextRelativePath: string;
}

const withWorkspaceLock = createCanonicalDirectoryQueue();

export function assertAgentGroupId(id: string, label = "id"): void {
  assertAgentGroupEntityId(id, label);
}

export function contextRevision(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function contextRelativePath(sessionId: string): string {
  assertAgentGroupId(sessionId, "session id");
  return path.posix.join(".agent-group", "sessions", sessionId, "context.md");
}

export async function isAgentGroupWorkspace(workspaceRoot: string): Promise<boolean> {
  let canonicalWorkspaceRoot: string;
  try {
    canonicalWorkspaceRoot = await canonicalDirectory(workspaceRoot);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
  const directory = path.join(canonicalWorkspaceRoot, ".agent-group");
  const directoryState = await existingPathState(directory);
  if (directoryState === "missing") return false;
  if (directoryState === "symlink" || directoryState !== "directory") {
    throw new Error(".agent-group must be a real directory");
  }
  const statePath = path.join(directory, "state.json");
  const statePathState = await existingPathState(statePath);
  if (statePathState === "missing") return false;
  if (statePathState !== "file") {
    throw new Error(".agent-group/state.json must be a regular file");
  }
  return true;
}

export async function withAgentGroupWorkspaceLock<T>(
  workspaceRoot: string,
  operation: (canonicalWorkspaceRoot: string) => Promise<T>,
): Promise<T> {
  return withWorkspaceLock(workspaceRoot, operation);
}

export async function ensureAgentGroupLayout(
  canonicalWorkspaceRoot: string,
): Promise<AgentGroupLayout> {
  const agentGroupDirectory = path.join(canonicalWorkspaceRoot, ".agent-group");
  const sessionsDirectory = path.join(agentGroupDirectory, "sessions");
  await ensureRealDirectory(agentGroupDirectory);
  await ensureRealDirectory(sessionsDirectory);
  return {
    workspaceRoot: canonicalWorkspaceRoot,
    agentGroupDirectory,
    sessionsDirectory,
    statePath: path.join(agentGroupDirectory, "state.json"),
  };
}

export async function loadOrCreateGroupState(
  layout: AgentGroupLayout,
  groupId: string,
): Promise<{ state: StoredGroupState; created: boolean }> {
  assertAgentGroupId(groupId, "group id");
  const statePathType = await existingPathState(layout.statePath);
  if (statePathType !== "missing" && statePathType !== "file") {
    throw new Error(".agent-group/state.json must be a regular file");
  }
  if (statePathType === "missing") {
    const state: StoredGroupState = {
      version: 1,
      groupId,
      revision: 0,
      contextEnabled: true,
      browserToolsEnabled: false,
      globalRules: "",
      contextTemplate: DEFAULT_CONTEXT_TEMPLATE,
      contextTemplateId: "standard",
      contextAwarenessDefaultEnabled: false,
      sessions: {},
    };
    await writeGroupState(layout, state);
    return { state, created: true };
  }

  const info = await stat(layout.statePath);
  if (info.size > MAX_STATE_BYTES) throw new Error(".agent-group/state.json is too large");
  const parsed = JSON.parse(await readFile(layout.statePath, "utf8")) as unknown;
  const state = validateStoredGroupState(parsed);
  return { state, created: false };
}

export async function writeGroupState(
  layout: AgentGroupLayout,
  state: StoredGroupState,
): Promise<void> {
  validateStoredGroupState(state);
  const content = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(content, "utf8") > MAX_STATE_BYTES) {
    throw new Error(".agent-group/state.json is too large");
  }
  await atomicWrite(layout.statePath, content);
}

export async function ensureSession(
  layout: AgentGroupLayout,
  state: StoredGroupState,
  input: AgentGroupCoordinates,
  initialContext = state.contextTemplate,
): Promise<EnsuredSession> {
  assertAgentGroupId(input.sessionId, "session id");
  if (input.parentSessionId) assertAgentGroupId(input.parentSessionId, "parent session id");

  const existing = state.sessions[input.sessionId];
  if (
    existing &&
    input.parentSessionId !== undefined &&
    existing.parentSessionId !== (input.parentSessionId ?? null)
  ) {
    throw new Error("Session parent cannot be changed through the context API");
  }

  const sessionDirectory = path.join(layout.sessionsDirectory, input.sessionId);
  await ensureRealDirectory(sessionDirectory);
  const contextPath = path.join(sessionDirectory, "context.md");
  const relativePath = contextRelativePath(input.sessionId);
  const contextState = await existingPathState(contextPath);
  if (contextState !== "missing" && contextState !== "file") {
    throw new Error("Session context must be a regular file");
  }

  let session = existing;
  let created = false;
  if (!session) {
    session = {
      sessionId: input.sessionId,
      parentSessionId: input.parentSessionId ?? null,
      createdAt: input.createdAt ?? new Date().toISOString(),
      firstTurnCompleted: false,
      contextAwarenessEnabled: state.contextAwarenessDefaultEnabled,
      contextSeenCommit: null,
      activeContextTurnId: null,
      activeContextAwarenessHead: null,
      activeContextRuntimeId: null,
    };
    state.sessions[input.sessionId] = session;
    state.revision += 1;
    created = true;
  }

  if (contextState === "missing" && existing) {
    throw new Error("Session context is missing; refusing to replace user-authored context");
  }
  if (contextState === "missing") {
    assertContextSize(initialContext);
    await atomicWrite(contextPath, initialContext);
  }

  if (session.parentSessionId) {
    await rejectExistingSymlink(path.join(layout.sessionsDirectory, session.parentSessionId));
    await rejectExistingSymlink(
      path.join(layout.sessionsDirectory, session.parentSessionId, "context.md"),
    );
  }

  return { session, created, contextPath, contextRelativePath: relativePath };
}

export async function readContext(contextPath: string): Promise<string> {
  const state = await existingPathState(contextPath);
  if (state !== "file") throw new Error("Session context is missing or unsafe");
  const info = await stat(contextPath);
  if (info.size > MAX_CONTEXT_BYTES) throw new Error("Session context exceeds 1 MiB");
  return readFile(contextPath, "utf8");
}

export async function writeContext(contextPath: string, content: string): Promise<void> {
  assertContextSize(content);
  const state = await existingPathState(contextPath);
  if (state !== "file") throw new Error("Session context is missing or unsafe");
  await atomicWrite(contextPath, content);
}

function validateStoredGroupState(input: unknown): StoredGroupState {
  if (!isRecord(input) || input.version !== 1) throw new Error("Invalid Agent Group state version");
  if (typeof input.groupId !== "string") throw new Error("Invalid Agent Group state group id");
  assertAgentGroupId(input.groupId, "group id");
  if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 0) {
    throw new Error("Invalid Agent Group state revision");
  }
  const contextEnabled = input.contextEnabled === undefined ? true : input.contextEnabled;
  if (typeof contextEnabled !== "boolean") {
    throw new Error("Invalid Agent Group context setting");
  }
  const browserToolsEnabled =
    input.browserToolsEnabled === undefined ? false : input.browserToolsEnabled;
  if (typeof browserToolsEnabled !== "boolean") {
    throw new Error("Invalid Agent Group browser tools setting");
  }
  assertBoundedString(input.globalRules, "global rules");
  assertBoundedString(input.contextTemplate, "context template");
  const inferredTemplateId = CONTEXT_TEMPLATE_PRESETS.find(
    (template) => template.content === input.contextTemplate,
  )?.id;
  const contextTemplateId =
    input.contextTemplateId === undefined ? (inferredTemplateId ?? null) : input.contextTemplateId;
  if (
    contextTemplateId !== null &&
    (typeof contextTemplateId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(contextTemplateId))
  ) {
    throw new Error("Invalid Agent Group context template id");
  }
  const contextAwarenessDefaultEnabled = input.contextAwarenessDefaultEnabled ?? false;
  if (typeof contextAwarenessDefaultEnabled !== "boolean") {
    throw new Error("Invalid Agent Group awareness default");
  }
  if (!isRecord(input.sessions)) throw new Error("Invalid Agent Group sessions");

  const sessions: Record<string, StoredSessionState> = {};
  for (const [sessionId, value] of Object.entries(input.sessions)) {
    assertAgentGroupId(sessionId, "session id");
    if (!isRecord(value) || value.sessionId !== sessionId) {
      throw new Error(`Invalid session state for '${sessionId}'`);
    }
    const parentSessionId = value.parentSessionId;
    const createdAt = value.createdAt;
    const firstTurnCompleted = value.firstTurnCompleted;
    const contextAwarenessEnabled = value.contextAwarenessEnabled;
    const contextSeenCommit = value.contextSeenCommit;
    const activeContextTurnId =
      value.activeContextTurnId === undefined ? null : value.activeContextTurnId;
    const activeContextAwarenessHead =
      value.activeContextAwarenessHead === undefined ? null : value.activeContextAwarenessHead;
    const activeContextRuntimeId =
      value.activeContextRuntimeId === undefined ? null : value.activeContextRuntimeId;
    if (parentSessionId !== null && typeof parentSessionId !== "string") {
      throw new Error(`Invalid parent session for '${sessionId}'`);
    }
    if (typeof parentSessionId === "string") {
      assertAgentGroupId(parentSessionId, "parent session id");
    }
    if (
      typeof createdAt !== "string" ||
      typeof firstTurnCompleted !== "boolean" ||
      typeof contextAwarenessEnabled !== "boolean" ||
      (contextSeenCommit !== null && typeof contextSeenCommit !== "string") ||
      (activeContextTurnId !== null && typeof activeContextTurnId !== "string") ||
      (activeContextAwarenessHead !== null && typeof activeContextAwarenessHead !== "string") ||
      (activeContextRuntimeId !== null && typeof activeContextRuntimeId !== "string")
    ) {
      throw new Error(`Invalid session state for '${sessionId}'`);
    }
    sessions[sessionId] = {
      sessionId,
      parentSessionId,
      createdAt,
      firstTurnCompleted,
      contextAwarenessEnabled,
      contextSeenCommit,
      activeContextTurnId,
      activeContextAwarenessHead,
      activeContextRuntimeId,
    };
  }

  return {
    version: 1,
    groupId: input.groupId,
    revision: input.revision as number,
    contextEnabled,
    browserToolsEnabled,
    globalRules: input.globalRules as string,
    contextTemplate: input.contextTemplate as string,
    contextTemplateId,
    contextAwarenessDefaultEnabled,
    sessions,
  };
}

async function rejectExistingSymlink(candidate: string): Promise<void> {
  if ((await existingPathState(candidate)) === "symlink") {
    throw new Error(`Context path must not contain symlinks: ${candidate}`);
  }
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const current = await existingPathState(target);
  if (current !== "missing" && current !== "file") {
    throw new Error(`Unsafe write target: ${target}`);
  }
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error) => {
      if (!isNodeError(error, "ENOENT")) throw error;
    });
  }
}

function assertContextSize(content: string): void {
  if (Buffer.byteLength(content, "utf8") > MAX_CONTEXT_BYTES) {
    throw new Error("Session context exceeds 1 MiB");
  }
}

function assertBoundedString(input: unknown, label: string): asserts input is string {
  if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > MAX_CONTEXT_BYTES) {
    throw new Error(`Invalid ${label}`);
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
