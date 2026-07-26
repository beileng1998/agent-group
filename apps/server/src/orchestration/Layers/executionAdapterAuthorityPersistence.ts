// FILE: executionAdapterAuthorityPersistence.ts
// Purpose: Permission-restricted atomic snapshots for adapter authority.
// Layer: Server orchestration persistence helper

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { ProviderKind, ThreadId } from "@agent-group/contracts";
import { Schema } from "effect";

import type { ExecutionAdapterAuthorityState } from "../Services/ExecutionAdapterAuthority";
import {
  terminalOwnerIdentityMatches,
  type TerminalOwnerIdentity,
} from "../../terminal/terminalProcessIdentity";
import type { TerminalProcessGroupIdentity } from "../../terminal/terminalProcessGroup";

const SNAPSHOT_VERSION = 3;
const OWNER_IDENTITY_SNAPSHOT_VERSION = 2;
const LEGACY_SNAPSHOT_VERSION = 1;
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;
const MAX_STATE_ENTRIES = 10_000;
const TERMINAL_STATUSES = new Set([
  "checking",
  "starting",
  "ready",
  "running",
  "attention",
  "context-blocked",
  "stopping",
  "deleting",
  "stopped",
  "exited",
  "error",
  "unsupported",
]);

export function executionAdapterAuthorityPath(stateDir: string): string {
  return path.join(stateDir, "terminal-agent", "execution-adapters.json");
}

function executionAdapterAuthorityUnavailablePath(filePath: string): string {
  return `${filePath}.unavailable`;
}

export interface ExecutionAdapterAuthorityLoadResult {
  readonly states: ReadonlyMap<ThreadId, ExecutionAdapterAuthorityState>;
  readonly authorityUnavailableReason: string | null;
  readonly quarantinePath: string | null;
  readonly cause: unknown | null;
}

export async function loadExecutionAdapterAuthority(
  filePath: string,
): Promise<ExecutionAdapterAuthorityLoadResult> {
  const unavailablePath = executionAdapterAuthorityUnavailablePath(filePath);
  try {
    await fs.lstat(unavailablePath);
    return unavailableLoadResult(new Error("A durable authority recovery marker is present."));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
      return unavailableLoadResult(cause);
    }
  }
  try {
    return {
      states: await readExecutionAdapterAuthority(filePath),
      authorityUnavailableReason: null,
      quarantinePath: null,
      cause: null,
    };
  } catch (cause) {
    const quarantinePath = `${filePath}.invalid-${Date.now()}-${randomUUID()}`;
    let quarantined: string | null = null;
    if (await persistUnavailableMarker(unavailablePath)) {
      try {
        await fs.rename(filePath, quarantinePath);
        quarantined = quarantinePath;
      } catch {
        // The marker keeps subsequent starts fail-closed even if quarantine
        // cannot be completed (for example, on read-only storage).
      }
    }
    return unavailableLoadResult(cause, quarantined);
  }
}

function unavailableLoadResult(
  cause: unknown,
  quarantinePath: string | null = null,
): ExecutionAdapterAuthorityLoadResult {
  return {
    states: new Map(),
    authorityUnavailableReason:
      "Execution adapters are unavailable because their durable authority snapshot could not be trusted. Resolve the quarantined state and remove its .unavailable marker before restarting.",
    quarantinePath,
    cause,
  };
}

async function persistUnavailableMarker(markerPath: string): Promise<boolean> {
  try {
    const handle = await fs.open(markerPath, "wx", 0o600);
    try {
      await handle.writeFile("manual recovery required\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncParentDirectory(path.dirname(markerPath), syncDirectory);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "EEXIST";
  }
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nullableInteger(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && Number(value) >= 0);
}

function decodeOwnerIdentity(value: unknown): TerminalOwnerIdentity | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid terminal owner identity.");
  }
  const identity = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(identity.pid) ||
    Number(identity.pid) <= 0 ||
    typeof identity.startTime !== "string" ||
    identity.startTime.length === 0 ||
    identity.startTime.length > 256 ||
    typeof identity.commandFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(identity.commandFingerprint)
  ) {
    throw new Error("Invalid terminal owner identity.");
  }
  return {
    pid: Number(identity.pid),
    startTime: identity.startTime,
    commandFingerprint: identity.commandFingerprint,
  };
}

function decodeProcessGroupIdentity(value: unknown): TerminalProcessGroupIdentity | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid terminal process-group identity.");
  }
  const group = value as Record<string, unknown>;
  const leaderIdentity = decodeOwnerIdentity(group.leaderIdentity);
  if (
    !Number.isSafeInteger(group.pgid) ||
    Number(group.pgid) <= 0 ||
    leaderIdentity === null ||
    leaderIdentity.pid !== Number(group.pgid)
  ) {
    throw new Error("Invalid terminal process-group identity.");
  }
  return { pgid: Number(group.pgid), leaderIdentity };
}

function decodeState(value: unknown, version: number): ExecutionAdapterAuthorityState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid execution adapter state.");
  }
  const state = value as Record<string, unknown>;
  if (!Number.isInteger(state.revision) || Number(state.revision) < 0) {
    throw new Error("Invalid execution adapter revision.");
  }
  const revision = Number(state.revision);
  if (state.adapter === "structured") {
    if (
      state.status !== undefined &&
      state.status !== "ready" &&
      state.status !== "restoring" &&
      state.status !== "stopping" &&
      state.status !== "deleting"
    ) {
      throw new Error("Invalid structured execution adapter status.");
    }
    return {
      adapter: "structured",
      revision,
      status:
        state.status === "restoring" || state.status === "stopping" || state.status === "deleting"
          ? state.status
          : "ready",
    };
  }
  if (
    state.adapter !== "terminal" ||
    !Schema.is(ProviderKind)(state.provider) ||
    typeof state.status !== "string" ||
    !TERMINAL_STATUSES.has(state.status) ||
    typeof state.runtimeInstanceId !== "string" ||
    state.runtimeInstanceId.length === 0 ||
    !nullableString(state.generation) ||
    !nullableInteger(state.pid) ||
    !nullableString(state.providerSessionId) ||
    !nullableString(state.activeTurnId) ||
    typeof state.startedAt !== "string" ||
    !nullableInteger(state.exitCode) ||
    !nullableInteger(state.exitSignal) ||
    !nullableString(state.error)
  ) {
    throw new Error("Invalid terminal execution adapter state.");
  }
  const ownerIdentity =
    version === LEGACY_SNAPSHOT_VERSION ? null : decodeOwnerIdentity(state.ownerIdentity);
  const processGroupIdentity =
    version <= OWNER_IDENTITY_SNAPSHOT_VERSION
      ? null
      : decodeProcessGroupIdentity(state.processGroupIdentity);
  if (ownerIdentity !== null && (state.pid === null || ownerIdentity.pid !== state.pid)) {
    throw new Error("Terminal owner identity does not match its PID.");
  }
  if (
    processGroupIdentity !== null &&
    (ownerIdentity === null ||
      state.pid !== processGroupIdentity.pgid ||
      !terminalOwnerIdentityMatches(ownerIdentity, processGroupIdentity.leaderIdentity))
  ) {
    throw new Error("Terminal process-group identity does not match its owner.");
  }
  return {
    ...(state as unknown as Omit<
      Extract<ExecutionAdapterAuthorityState, { adapter: "terminal" }>,
      "ownerIdentity" | "processGroupIdentity"
    >),
    ownerIdentity,
    processGroupIdentity,
  };
}

export async function readExecutionAdapterAuthority(
  filePath: string,
): Promise<ReadonlyMap<ThreadId, ExecutionAdapterAuthorityState>> {
  let stats;
  try {
    stats = await fs.lstat(filePath);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw cause;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("Execution adapter authority path must be a regular file.");
  }
  if (stats.size > MAX_SNAPSHOT_BYTES) {
    throw new Error("Execution adapter authority snapshot is too large.");
  }
  const decoded = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("Invalid execution adapter authority snapshot.");
  }
  const record = decoded as Record<string, unknown>;
  if (
    (record.version !== SNAPSHOT_VERSION &&
      record.version !== OWNER_IDENTITY_SNAPSHOT_VERSION &&
      record.version !== LEGACY_SNAPSHOT_VERSION) ||
    !Array.isArray(record.states)
  ) {
    throw new Error("Unsupported execution adapter authority snapshot.");
  }
  if (record.states.length > MAX_STATE_ENTRIES) {
    throw new Error("Execution adapter authority snapshot has too many entries.");
  }
  const states = new Map<ThreadId, ExecutionAdapterAuthorityState>();
  for (const entry of record.states) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Invalid execution adapter authority entry.");
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.threadId !== "string" || item.threadId.length === 0) {
      throw new Error("Invalid execution adapter authority thread id.");
    }
    states.set(ThreadId.makeUnsafe(item.threadId), decodeState(item.state, Number(record.version)));
  }
  return states;
}

export async function writeExecutionAdapterAuthority(
  filePath: string,
  states: ReadonlyMap<ThreadId, ExecutionAdapterAuthorityState>,
  options: {
    readonly syncDirectory?: (directoryPath: string) => Promise<void>;
  } = {},
): Promise<void> {
  if (states.size > MAX_STATE_ENTRIES) {
    throw new Error("Execution adapter authority has too many entries.");
  }
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const body = `${JSON.stringify({
    version: SNAPSHOT_VERSION,
    states: [...states].map(([threadId, state]) => ({ threadId, state })),
  })}\n`;
  if (Buffer.byteLength(body) > MAX_SNAPSHOT_BYTES) {
    throw new Error("Execution adapter authority snapshot is too large.");
  }
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(body, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, filePath);
    await fs.chmod(filePath, 0o600);
    await syncParentDirectory(directory, options.syncDirectory ?? syncDirectory);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

const UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set([
  "EINVAL",
  "EISDIR",
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
]);

async function syncDirectory(directoryPath: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await fs.open(directoryPath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncParentDirectory(
  directoryPath: string,
  sync: (directoryPath: string) => Promise<void>,
): Promise<void> {
  try {
    await sync(directoryPath);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code && UNSUPPORTED_DIRECTORY_SYNC_CODES.has(code)) return;
    throw cause;
  }
}
