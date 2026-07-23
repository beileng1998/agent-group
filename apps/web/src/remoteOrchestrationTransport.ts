// FILE: remoteOrchestrationTransport.ts
// Purpose: Keep browser orchestration usable when the WebSocket path is degraded.
// Layer: Browser remote transport

import {
  ORCHESTRATION_WS_METHODS,
  RemoteCommandResult,
  RemoteEventBatch,
  type ClientOrchestrationCommand,
  type DispatchResult,
  type OrchestrationEvent,
  type RemoteBootstrapSnapshot,
  type RemoteEventBatch as RemoteEventBatchValue,
} from "@agent-group/contracts";
import { Schema } from "effect";

import { refreshRemoteBootstrap, resolveRemoteBootstrapThreadId } from "./remoteBootstrapClient";
import {
  publishOrchestrationShellEvent,
  publishOrchestrationThreadEvent,
} from "./ws-native/wsNativeEventRegistry";
import type { WsTransport } from "./wsTransport";
import type { WsTransportState } from "./wsTransportEvents";

const COMMAND_TIMEOUT_MS = 60_000;
const EVENT_REQUEST_TIMEOUT_MS = 35_000;
const EVENT_RETRY_MS = 2_000;
const ROUTE_CHECK_MS = 250;
const decodeCommandResult = Schema.decodeUnknownSync(RemoteCommandResult);
const decodeEventBatch = Schema.decodeUnknownSync(RemoteEventBatch);

class RemoteHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function responseError(response: Response, payload: unknown, fallback: string): RemoteHttpError {
  const message =
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
      ? payload.error
      : fallback;
  return new RemoteHttpError(message, response.status);
}

async function requestRemoteCommand(
  command: ClientOrchestrationCommand,
): Promise<DispatchResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS);
  try {
    const response = await fetch("/api/remote-command", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      throw responseError(response, payload, `Remote command failed with status ${response.status}`);
    }
    return decodeCommandResult(payload);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function requestRemoteEvents(input: {
  readonly afterSequence: number;
  readonly threadId: string | null;
  readonly signal: AbortSignal;
}): Promise<RemoteEventBatchValue> {
  const query = new URLSearchParams({ after: String(input.afterSequence) });
  if (input.threadId) query.set("threadId", input.threadId);
  const controller = new AbortController();
  const abortFromLoop = () => controller.abort(input.signal.reason);
  if (input.signal.aborted) abortFromLoop();
  else input.signal.addEventListener("abort", abortFromLoop, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), EVENT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/remote-events?${query}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      throw responseError(response, payload, `Remote events failed with status ${response.status}`);
    }
    return decodeEventBatch(payload);
  } finally {
    window.clearTimeout(timeout);
    input.signal.removeEventListener("abort", abortFromLoop);
  }
}

async function requestRemoteEventsForRoute(input: {
  readonly afterSequence: number;
  readonly threadId: string | null;
  readonly loopSignal: AbortSignal;
}): Promise<RemoteEventBatchValue> {
  const controller = new AbortController();
  const abortFromLoop = () => controller.abort(input.loopSignal.reason);
  if (input.loopSignal.aborted) abortFromLoop();
  else input.loopSignal.addEventListener("abort", abortFromLoop, { once: true });
  const routeCheck = window.setInterval(() => {
    if (resolveRemoteBootstrapThreadId() !== input.threadId) controller.abort();
  }, ROUTE_CHECK_MS);
  try {
    return await requestRemoteEvents({
      afterSequence: input.afterSequence,
      threadId: input.threadId,
      signal: controller.signal,
    });
  } finally {
    window.clearInterval(routeCheck);
    input.loopSignal.removeEventListener("abort", abortFromLoop);
  }
}

function publishBootstrap(snapshot: RemoteBootstrapSnapshot): number {
  publishOrchestrationShellEvent({ kind: "snapshot", snapshot: snapshot.shell });
  if (snapshot.thread) {
    publishOrchestrationThreadEvent({ kind: "snapshot", snapshot: snapshot.thread });
    return Math.min(snapshot.shell.snapshotSequence, snapshot.thread.snapshotSequence);
  }
  return snapshot.shell.snapshotSequence;
}

function publishEventBatch(batch: RemoteEventBatchValue): void {
  for (const event of batch.shellEvents) publishOrchestrationShellEvent(event);
  for (const event of batch.threadEvents) {
    publishOrchestrationThreadEvent({ kind: "event", event });
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export interface RemoteOrchestrationTransport {
  readonly dispatchCommand: (command: ClientOrchestrationCommand) => Promise<DispatchResult>;
  readonly replayEvents: (fromSequenceExclusive: number) => Promise<OrchestrationEvent[]>;
  readonly dispose: () => void;
}

export function createRemoteOrchestrationTransport(
  wsTransport: WsTransport,
): RemoteOrchestrationTransport {
  const enabled = !window.desktopBridge;
  let state: WsTransportState = wsTransport.getState();
  let disposed = false;
  let loopController: AbortController | null = null;
  const catchupControllers = new Set<AbortController>();

  const stopEventLoop = () => {
    loopController?.abort();
    loopController = null;
  };

  const catchUpEvents = async (afterSequence: number): Promise<OrchestrationEvent[]> => {
    if (disposed) return [];
    const controller = new AbortController();
    catchupControllers.add(controller);
    const threadId = resolveRemoteBootstrapThreadId();
    try {
      const batch = await requestRemoteEventsForRoute({
        afterSequence,
        threadId,
        loopSignal: controller.signal,
      });
      publishEventBatch(batch);
      return Array.from(batch.threadEvents);
    } finally {
      catchupControllers.delete(controller);
    }
  };

  const runEventLoop = async (signal: AbortSignal) => {
    let threadId: string | null = null;
    let cursor: number | null = null;
    while (!disposed && !signal.aborted && state !== "open") {
      try {
        const nextThreadId = resolveRemoteBootstrapThreadId();
        if (cursor === null || nextThreadId !== threadId) {
          const bootstrap = await refreshRemoteBootstrap(nextThreadId);
          if (resolveRemoteBootstrapThreadId() !== nextThreadId) {
            cursor = null;
            continue;
          }
          threadId = nextThreadId;
          cursor = publishBootstrap(bootstrap);
        }
        const batch = await requestRemoteEventsForRoute({
          afterSequence: cursor,
          threadId,
          loopSignal: signal,
        });
        publishEventBatch(batch);
        cursor = Math.max(cursor, batch.nextSequence);
      } catch (error) {
        if (signal.aborted) return;
        if (resolveRemoteBootstrapThreadId() !== threadId) {
          cursor = null;
          continue;
        }
        console.warn("Remote event fallback interrupted", error);
        await abortableDelay(EVENT_RETRY_MS, signal);
      }
    }
  };

  const startEventLoop = () => {
    if (!enabled || disposed || state === "open" || state === "disposed" || loopController) return;
    const controller = new AbortController();
    loopController = controller;
    void runEventLoop(controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted) console.warn("Remote event fallback failed", error);
      })
      .finally(() => {
        if (loopController === controller) loopController = null;
        if (!disposed && state !== "open" && state !== "disposed") startEventLoop();
      });
  };

  const unsubscribeState = wsTransport.onStateChange(
    (nextState) => {
      state = nextState;
      if (state === "open" || state === "disposed") stopEventLoop();
      else startEventLoop();
    },
    { replayCurrent: true },
  );

  return {
    dispatchCommand: async (command) => {
      if (!enabled) {
        return wsTransport.request(ORCHESTRATION_WS_METHODS.dispatchCommand, { command });
      }
      try {
        const result = await requestRemoteCommand(command);
        if (result.sequence > 0 && wsTransport.getState() === "open") {
          void catchUpEvents(result.sequence - 1).catch((error) => {
            if (!disposed) console.warn("Remote command event catch-up failed", error);
          });
        }
        return result;
      } catch (error) {
        if (
          error instanceof RemoteHttpError &&
          error.status !== 404 &&
          error.status !== 405 &&
          error.status !== 501
        ) {
          throw error;
        }
        if (wsTransport.getState() !== "open") throw error;
        return wsTransport.request(ORCHESTRATION_WS_METHODS.dispatchCommand, { command });
      }
    },
    replayEvents: async (fromSequenceExclusive) => {
      if (!enabled) {
        return wsTransport.request(ORCHESTRATION_WS_METHODS.replayEvents, {
          fromSequenceExclusive,
        });
      }
      if (wsTransport.getState() !== "open") return [];
      try {
        return await catchUpEvents(fromSequenceExclusive);
      } catch (error) {
        if (
          error instanceof RemoteHttpError &&
          error.status !== 404 &&
          error.status !== 405 &&
          error.status !== 501
        ) {
          throw error;
        }
        if (wsTransport.getState() !== "open") return [];
        return wsTransport.request(ORCHESTRATION_WS_METHODS.replayEvents, {
          fromSequenceExclusive,
        });
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribeState();
      stopEventLoop();
      for (const controller of catchupControllers) controller.abort();
      catchupControllers.clear();
    },
  };
}
