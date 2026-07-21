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

function notify<T>(listeners: ReadonlySet<(payload: T) => void>, payload: T): void {
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      // Push listeners are isolated from each other and from transport dispatch.
    }
  }
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
    notify(orchestrationShellEventListeners, message.data),
  );
  transport.subscribe(ORCHESTRATION_WS_CHANNELS.threadEvent, (message) =>
    notify(orchestrationThreadEventListeners, message.data),
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
}
