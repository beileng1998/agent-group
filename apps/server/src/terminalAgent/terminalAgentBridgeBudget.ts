import type http from "node:http";

import type { TerminalAgentBridgeRequest } from "./terminalAgentProtocol";

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_PENDING_REQUESTS = 32;
const MAX_PENDING_BODY_BYTES = 4 * MAX_REQUEST_BYTES;
const MAX_EVENT_ID_LENGTH = 128;
const MAX_MODE_LENGTH = 64;

export class TerminalAgentBridgeBudgetExceeded extends Error {}

export interface TerminalAgentBridgeResourceLimits {
  readonly maxPendingRequests?: number;
  readonly maxPendingBodyBytes?: number;
}

export interface TerminalAgentBridgeBudgetOwner {
  pendingRequests: number;
  pendingBodyBytes: number;
}

export interface TerminalAgentBridgeRequestBudget {
  bodyBytes: number;
  released: boolean;
}

export interface ResolvedTerminalAgentBridgeResourceLimits {
  readonly maxPendingRequests: number;
  readonly maxPendingBodyBytes: number;
}

export function resolveTerminalAgentBridgeResourceLimits(
  limits: TerminalAgentBridgeResourceLimits,
): ResolvedTerminalAgentBridgeResourceLimits {
  const resolved = {
    maxPendingRequests: limits.maxPendingRequests ?? MAX_PENDING_REQUESTS,
    maxPendingBodyBytes: limits.maxPendingBodyBytes ?? MAX_PENDING_BODY_BYTES,
  };
  if (
    !Number.isSafeInteger(resolved.maxPendingRequests) ||
    !Number.isSafeInteger(resolved.maxPendingBodyBytes) ||
    resolved.maxPendingRequests < 1 ||
    resolved.maxPendingBodyBytes < 1
  ) {
    throw new Error("Managed terminal bridge limits must be positive integers.");
  }
  return resolved;
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error("Bridge string is too long.");
  return trimmed || undefined;
}

export function parseTerminalAgentBridgeRequest(value: unknown): TerminalAgentBridgeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid bridge request.");
  }
  const record = value as Record<string, unknown>;
  const runtimeInstanceId = boundedString(record.runtimeInstanceId, 128);
  if (!runtimeInstanceId) throw new Error("Invalid runtime id.");
  const eventId = boundedString(record.eventId, MAX_EVENT_ID_LENGTH);
  const mode = boundedString(record.mode, MAX_MODE_LENGTH);
  return {
    runtimeInstanceId,
    input: record.input,
    ...(eventId ? { eventId } : {}),
    ...(mode ? { mode } : {}),
  };
}

export function declaredBodyBytes(request: http.IncomingMessage): number | undefined {
  const header = request.headers["content-length"];
  if (header === undefined) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(header)) throw new Error("Invalid content length.");
  const bytes = Number(header);
  if (!Number.isSafeInteger(bytes) || bytes > MAX_REQUEST_BYTES) {
    throw new Error("Request is too large.");
  }
  return bytes;
}

export async function discardRequestBody(request: http.IncomingMessage): Promise<void> {
  if (request.complete) return;
  await new Promise<void>((resolve) => {
    const finish = () => resolve();
    request.once("end", finish);
    request.once("aborted", finish);
    request.once("error", finish);
    request.resume();
  });
}

export async function readJsonBody(
  request: http.IncomingMessage,
  reserveThrough: (bodyBytes: number) => boolean,
): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("Request is too large.");
    if (!reserveThrough(size)) throw new TerminalAgentBridgeBudgetExceeded();
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function reserveRequestBudget(
  owner: TerminalAgentBridgeBudgetOwner,
  bodyBytes: number,
  limits: ResolvedTerminalAgentBridgeResourceLimits,
): TerminalAgentBridgeRequestBudget | null {
  if (
    owner.pendingRequests >= limits.maxPendingRequests ||
    owner.pendingBodyBytes + bodyBytes > limits.maxPendingBodyBytes
  ) {
    return null;
  }
  owner.pendingRequests += 1;
  owner.pendingBodyBytes += bodyBytes;
  return { bodyBytes, released: false };
}

export function reserveBodyThrough(
  owner: TerminalAgentBridgeBudgetOwner,
  budget: TerminalAgentBridgeRequestBudget,
  bodyBytes: number,
  limits: ResolvedTerminalAgentBridgeResourceLimits,
): boolean {
  if (bodyBytes <= budget.bodyBytes) return true;
  const addedBytes = bodyBytes - budget.bodyBytes;
  if (owner.pendingBodyBytes + addedBytes > limits.maxPendingBodyBytes) {
    return false;
  }
  owner.pendingBodyBytes += addedBytes;
  budget.bodyBytes = bodyBytes;
  return true;
}

export function releaseRequestBudget(
  owner: TerminalAgentBridgeBudgetOwner,
  budget: TerminalAgentBridgeRequestBudget,
): void {
  if (budget.released) return;
  budget.released = true;
  owner.pendingRequests -= 1;
  owner.pendingBodyBytes -= budget.bodyBytes;
}
