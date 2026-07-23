// FILE: wsNativeEventRegistry.ts
// Purpose: Owns WebSocket push listeners, replay, and subscription wiring.
// Layer: Web transport adapter

import {
  ORCHESTRATION_WS_CHANNELS,
  WS_CHANNELS,
  type GitActionProgressEvent,
  type OrchestrationShellStreamItem,
  type OrchestrationThreadStreamItem,
  type ProjectDevServerEvent,
  type ServerConfigUpdatedPayload,
  type ServerLifecycleStreamEvent,
  type ServerProviderStatusesUpdatedPayload,
  type ServerSettingsUpdatedPayload,
  type TerminalEvent,
  type WsWelcomePayload,
} from "@agent-group/contracts";
import type { WsTransport } from "../wsTransport";

let activeTransport: WsTransport | null = null;
let latestShellSnapshot: OrchestrationShellStreamItem | null = null;
let latestShellSequence = -1;
let retainedShellEvents: OrchestrationShellStreamItem[] = [];
const latestThreadSnapshots = new Map<string, OrchestrationThreadStreamItem>();
const latestThreadSequenceById = new Map<string, number>();
const retainedThreadEventsById = new Map<string, OrchestrationThreadStreamItem[]>();
const MAX_RETAINED_THREAD_SNAPSHOTS = 8;
const MAX_RETAINED_ORCHESTRATION_EVENTS = 256;

export const welcomeListeners = new Set<(payload: WsWelcomePayload) => void>();
export const serverConfigUpdatedListeners = new Set<
  (payload: ServerConfigUpdatedPayload) => void
>();
export const serverProviderStatusesUpdatedListeners = new Set<
  (payload: ServerProviderStatusesUpdatedPayload) => void
>();
export const serverMaintenanceUpdatedListeners = new Set<
  (payload: ServerLifecycleStreamEvent) => void
>();
export const serverSettingsUpdatedListeners = new Set<
  (payload: ServerSettingsUpdatedPayload) => void
>();
export const gitActionProgressListeners = new Set<(payload: GitActionProgressEvent) => void>();
export const terminalEventListeners = new Set<(payload: TerminalEvent) => void>();
export const projectDevServerEventListeners = new Set<(payload: ProjectDevServerEvent) => void>();
export const orchestrationShellEventListeners = new Set<
  (payload: OrchestrationShellStreamItem) => void
>();
export const orchestrationThreadEventListeners = new Set<
  (payload: OrchestrationThreadStreamItem) => void
>();

function notifyOne<T>(listener: (payload: T) => void, payload: T): void {
  try {
    listener(payload);
  } catch {
    // Push listeners are isolated from each other and from transport dispatch.
  }
}

function notify<T>(listeners: ReadonlySet<(payload: T) => void>, payload: T): void {
  for (const listener of listeners) notifyOne(listener, payload);
}

function appendRetained<T>(items: T[], item: T): void {
  items.push(item);
  if (items.length > MAX_RETAINED_ORCHESTRATION_EVENTS) items.shift();
}

export function publishOrchestrationShellEvent(payload: OrchestrationShellStreamItem): void {
  const sequence =
    payload.kind === "snapshot" ? payload.snapshot.snapshotSequence : payload.sequence;
  if (sequence < latestShellSequence) return;
  if (payload.kind !== "snapshot" && sequence === latestShellSequence) return;
  latestShellSequence = sequence;
  if (payload.kind === "snapshot") {
    latestShellSnapshot = payload;
    retainedShellEvents = retainedShellEvents.filter(
      (item) => item.kind !== "snapshot" && item.sequence > sequence,
    );
  } else {
    appendRetained(retainedShellEvents, payload);
  }
  notify(orchestrationShellEventListeners, payload);
}

export function publishOrchestrationThreadEvent(payload: OrchestrationThreadStreamItem): void {
  const threadId =
    payload.kind === "snapshot"
      ? payload.snapshot.thread.id
      : String(payload.event.aggregateId);
  const sequence =
    payload.kind === "snapshot" ? payload.snapshot.snapshotSequence : payload.event.sequence;
  const latestSequence = latestThreadSequenceById.get(threadId) ?? -1;
  if (sequence < latestSequence) return;
  if (payload.kind !== "snapshot" && sequence === latestSequence) return;
  latestThreadSequenceById.set(threadId, sequence);
  if (payload.kind === "snapshot") {
    latestThreadSnapshots.delete(threadId);
    latestThreadSnapshots.set(threadId, payload);
    const retainedEvents = retainedThreadEventsById.get(threadId) ?? [];
    retainedThreadEventsById.set(
      threadId,
      retainedEvents.filter(
        (item) => item.kind !== "snapshot" && item.event.sequence > sequence,
      ),
    );
    while (latestThreadSnapshots.size > MAX_RETAINED_THREAD_SNAPSHOTS) {
      const oldest = latestThreadSnapshots.keys().next().value as string | undefined;
      if (!oldest) break;
      latestThreadSnapshots.delete(oldest);
      retainedThreadEventsById.delete(oldest);
      latestThreadSequenceById.delete(oldest);
    }
  } else {
    const retainedEvents = retainedThreadEventsById.get(threadId) ?? [];
    appendRetained(retainedEvents, payload);
    retainedThreadEventsById.set(threadId, retainedEvents);
  }
  notify(orchestrationThreadEventListeners, payload);
}

export function onOrchestrationShellEvent(
  listener: (payload: OrchestrationShellStreamItem) => void,
): () => void {
  orchestrationShellEventListeners.add(listener);
  if (latestShellSnapshot) notifyOne(listener, latestShellSnapshot);
  for (const event of retainedShellEvents) notifyOne(listener, event);
  return () => orchestrationShellEventListeners.delete(listener);
}

export function onOrchestrationThreadEvent(
  listener: (payload: OrchestrationThreadStreamItem) => void,
): () => void {
  orchestrationThreadEventListeners.add(listener);
  for (const [threadId, snapshot] of latestThreadSnapshots) {
    notifyOne(listener, snapshot);
    for (const event of retainedThreadEventsById.get(threadId) ?? []) {
      notifyOne(listener, event);
    }
  }
  return () => orchestrationThreadEventListeners.delete(listener);
}

function subscribeWithReplay<T>(input: {
  listeners: Set<(payload: T) => void>;
  listener: (payload: T) => void;
  readLatest: (transport: WsTransport) => T | null;
}): () => void {
  input.listeners.add(input.listener);
  const latest = activeTransport ? input.readLatest(activeTransport) : null;
  if (latest) {
    try {
      input.listener(latest);
    } catch {
      // Preserve listener error isolation for synchronous replay.
    }
  }
  return () => {
    input.listeners.delete(input.listener);
  };
}

export function onServerWelcome(listener: (payload: WsWelcomePayload) => void): () => void {
  return subscribeWithReplay({
    listeners: welcomeListeners,
    listener,
    readLatest: (transport) => transport.getLatestPush(WS_CHANNELS.serverWelcome)?.data ?? null,
  });
}

export function onServerConfigUpdated(
  listener: (payload: ServerConfigUpdatedPayload) => void,
): () => void {
  return subscribeWithReplay({
    listeners: serverConfigUpdatedListeners,
    listener,
    readLatest: (transport) =>
      transport.getLatestPush(WS_CHANNELS.serverConfigUpdated)?.data ?? null,
  });
}

export function onServerProviderStatusesUpdated(
  listener: (payload: ServerProviderStatusesUpdatedPayload) => void,
): () => void {
  return subscribeWithReplay({
    listeners: serverProviderStatusesUpdatedListeners,
    listener,
    readLatest: (transport) =>
      transport.getLatestPush(WS_CHANNELS.serverProviderStatusesUpdated)?.data ?? null,
  });
}

export function onServerMaintenanceUpdated(
  listener: (payload: ServerLifecycleStreamEvent) => void,
): () => void {
  return subscribeWithReplay({
    listeners: serverMaintenanceUpdatedListeners,
    listener,
    readLatest: (transport) =>
      transport.getLatestPush(WS_CHANNELS.serverMaintenanceUpdated)?.data ?? null,
  });
}

export function onServerSettingsUpdated(
  listener: (payload: ServerSettingsUpdatedPayload) => void,
): () => void {
  return subscribeWithReplay({
    listeners: serverSettingsUpdatedListeners,
    listener,
    readLatest: (transport) =>
      transport.getLatestPush(WS_CHANNELS.serverSettingsUpdated)?.data ?? null,
  });
}

export function registerWsPushSubscriptions(transport: WsTransport): void {
  activeTransport = transport;
  transport.subscribe(WS_CHANNELS.serverWelcome, (message) =>
    notify(welcomeListeners, message.data),
  );
  transport.subscribe(WS_CHANNELS.serverConfigUpdated, (message) =>
    notify(serverConfigUpdatedListeners, message.data),
  );
  transport.subscribe(WS_CHANNELS.serverProviderStatusesUpdated, (message) =>
    notify(serverProviderStatusesUpdatedListeners, message.data),
  );
  transport.subscribe(WS_CHANNELS.serverMaintenanceUpdated, (message) =>
    notify(serverMaintenanceUpdatedListeners, message.data),
  );
  transport.subscribe(WS_CHANNELS.serverSettingsUpdated, (message) =>
    notify(serverSettingsUpdatedListeners, message.data),
  );
  transport.subscribe(WS_CHANNELS.gitActionProgress, (message) =>
    notify(gitActionProgressListeners, message.data),
  );
  transport.subscribe(WS_CHANNELS.terminalEvent, (message) =>
    notify(terminalEventListeners, message.data),
  );
  transport.subscribe(WS_CHANNELS.projectDevServerEvent, (message) =>
    notify(projectDevServerEventListeners, message.data),
  );
  transport.subscribe(ORCHESTRATION_WS_CHANNELS.shellEvent, (message) =>
    publishOrchestrationShellEvent(message.data),
  );
  transport.subscribe(ORCHESTRATION_WS_CHANNELS.threadEvent, (message) =>
    publishOrchestrationThreadEvent(message.data),
  );
}

export function resetWsEventRegistry(includeMaintenance: boolean): void {
  activeTransport = null;
  welcomeListeners.clear();
  serverConfigUpdatedListeners.clear();
  serverProviderStatusesUpdatedListeners.clear();
  if (includeMaintenance) {
    serverMaintenanceUpdatedListeners.clear();
  }
  serverSettingsUpdatedListeners.clear();
  gitActionProgressListeners.clear();
  terminalEventListeners.clear();
  projectDevServerEventListeners.clear();
  orchestrationShellEventListeners.clear();
  orchestrationThreadEventListeners.clear();
  latestShellSnapshot = null;
  latestShellSequence = -1;
  retainedShellEvents = [];
  latestThreadSnapshots.clear();
  latestThreadSequenceById.clear();
  retainedThreadEventsById.clear();
}
