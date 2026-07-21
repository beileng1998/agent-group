import {
  ModelSelection,
  ProviderStartOptions,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@agent-group/contracts";
import { Schema } from "effect";

import type { ProviderRuntimeBinding } from "./Services/ProviderSessionDirectory.ts";

export function toRuntimeStatus(
  session: ProviderSession,
): "starting" | "running" | "stopped" | "error" {
  switch (session.status) {
    case "connecting":
      return "starting";
    case "error":
      return "error";
    case "closed":
      return "stopped";
    case "ready":
    case "running":
    default:
      return "running";
  }
}

export function toRuntimePayloadFromSession(
  session: ProviderSession,
  extra?: {
    readonly modelSelection?: unknown;
    readonly providerOptions?: unknown;
    readonly lastRuntimeEvent?: string;
    readonly lastRuntimeEventAt?: string;
  },
): Record<string, unknown> {
  return {
    cwd: session.cwd ?? null,
    model: session.model ?? null,
    activeTurnId: session.activeTurnId ?? null,
    lastError: session.lastError ?? null,
    ...(extra?.modelSelection !== undefined ? { modelSelection: extra.modelSelection } : {}),
    ...(extra?.providerOptions !== undefined ? { providerOptions: extra.providerOptions } : {}),
    ...(extra?.lastRuntimeEvent !== undefined ? { lastRuntimeEvent: extra.lastRuntimeEvent } : {}),
    ...(extra?.lastRuntimeEventAt !== undefined
      ? { lastRuntimeEventAt: extra.lastRuntimeEventAt }
      : {}),
  };
}

export function readPersistedModelSelection(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): ModelSelection | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const raw = "modelSelection" in runtimePayload ? runtimePayload.modelSelection : undefined;
  return Schema.is(ModelSelection)(raw) ? raw : undefined;
}

export function readPersistedProviderOptions(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): ProviderStartOptions | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const raw = "providerOptions" in runtimePayload ? runtimePayload.providerOptions : undefined;
  return Schema.is(ProviderStartOptions)(raw) ? raw : undefined;
}

export function readPersistedCwd(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): string | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const rawCwd = "cwd" in runtimePayload ? runtimePayload.cwd : undefined;
  if (typeof rawCwd !== "string") return undefined;
  const trimmed = rawCwd.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function runtimePayloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function hasResumeCursor(value: unknown): boolean {
  return value !== null && value !== undefined;
}

export function runtimeStatusForEvent(
  event: ProviderRuntimeEvent,
  activeTurnId?: unknown,
): "running" | "stopped" | "error" {
  switch (event.type) {
    case "session.state.changed":
      switch (event.payload.state) {
        case "stopped":
          return "stopped";
        case "error":
          return "error";
        default:
          return "running";
      }
    case "thread.state.changed":
      switch (event.payload.state) {
        case "error":
          return "error";
        case "archived":
        case "closed":
          return "stopped";
        case "compacted":
          return event.turnId === undefined && activeTurnId == null ? "stopped" : "running";
        default:
          return "running";
      }
    case "session.exited":
    case "turn.completed":
    case "turn.aborted":
      return "stopped";
    case "runtime.error":
      return "error";
    default:
      return "running";
  }
}

export function shouldRefreshResumeCursorForEvent(event: ProviderRuntimeEvent): boolean {
  return (
    event.type === "thread.started" ||
    event.type === "model.rerouted" ||
    (event.type === "thread.state.changed" &&
      event.payload.state === "compacted" &&
      event.turnId === undefined) ||
    event.type === "turn.tasks.updated" ||
    event.type === "turn.completed" ||
    event.type === "turn.aborted"
  );
}

export function runtimeLastErrorForEvent(event: ProviderRuntimeEvent): string | null | undefined {
  switch (event.type) {
    case "runtime.error":
      return event.payload.message;
    case "session.state.changed":
      return event.payload.state === "error" ? (event.payload.reason ?? "Session error") : null;
    case "thread.state.changed":
      return event.payload.state === "error" ? "Thread error" : null;
    case "turn.started":
    case "turn.completed":
    case "turn.aborted":
    case "session.exited":
      return null;
    default:
      return undefined;
  }
}
