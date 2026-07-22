// FILE: wsNativeApi.ts
// Purpose: NativeApi implementation backed by the browser WebSocket RPC transport.
// Layer: Web transport adapter
// Exports: createWsNativeApi and event subscription helpers for server push channels.

import {
  type AuthBearerBootstrapResult,
  type AuthBootstrapInput,
  type AuthBootstrapResult,
  type AuthClientSession,
  type AuthCreatePairingCredentialInput,
  type AuthPairingCredentialResult,
  type AuthPairingLink,
  type AuthRevokeClientSessionInput,
  type AuthRevokePairingLinkInput,
  type AuthSessionState,
  type AuthWebSocketTokenResult,
  type RemoteAccessStatus,
  ORCHESTRATION_WS_METHODS,
  type ContextMenuItem,
  type NativeApi,
  WS_CHANNELS,
  WS_METHODS,
} from "@agent-group/contracts";

import { showConfirmDialogFallback } from "./confirmDialogFallback";
import { showContextMenuFallback } from "./contextMenuFallback";
import { requireHttpExternalUrl } from "./lib/externalUrl";
import {
  getRemoteAgentGroupSession,
  getRemoteShellSnapshot,
} from "./remoteBootstrapClient";
import { WsTransport } from "./wsTransport";
import { emitWsTransportState } from "./wsTransportEvents";
import { createBrowserApi, resetFallbackBrowserApi } from "./ws-native/fallbackBrowserApi";
import {
  gitActionProgressListeners,
  orchestrationShellEventListeners,
  orchestrationThreadEventListeners,
  projectDevServerEventListeners,
  registerWsPushSubscriptions,
  resetWsEventRegistry,
  terminalEventListeners,
} from "./ws-native/wsNativeEventRegistry";

export {
  onServerConfigUpdated,
  onServerMaintenanceUpdated,
  onServerProviderStatusesUpdated,
  onServerSettingsUpdated,
  onServerWelcome,
} from "./ws-native/wsNativeEventRegistry";

let instance: { api: NativeApi; transport: WsTransport } | null = null;
const REMOTE_READ_WS_FALLBACK_DELAY_MS = 8_000;

function remoteReadWithWsFallback<T>(
  remoteRead: () => Promise<T>,
  wsRead: () => Promise<T>,
): Promise<T> {
  let fallbackPromise: Promise<T> | null = null;
  const startFallback = () => (fallbackPromise ??= wsRead());
  let timer: number | null = null;
  const delayedFallback = new Promise<T>((resolve, reject) => {
    timer = window.setTimeout(
      () => void startFallback().then(resolve, reject),
      REMOTE_READ_WS_FALLBACK_DELAY_MS,
    );
  });
  const primary = remoteRead().catch(() => startFallback());
  return Promise.any([primary, delayedFallback])
    .catch(() => startFallback())
    .finally(() => {
      if (timer !== null) window.clearTimeout(timer);
    });
}

function omitNullUserInputAnswers(
  command: Parameters<NativeApi["orchestration"]["dispatchCommand"]>[0],
) {
  if (command.type !== "thread.user-input.respond") {
    return command;
  }

  return {
    ...command,
    answers: Object.fromEntries(
      Object.entries(command.answers).filter(
        ([, answer]) => answer !== null && answer !== undefined,
      ),
    ),
  };
}
async function requestAuthJson<T>(
  path: string,
  options: {
    readonly method?: "GET" | "POST";
    readonly body?: unknown;
  } = {},
): Promise<T> {
  if (window.desktopBridge?.server?.requestAuthJson) {
    return window.desktopBridge.server.requestAuthJson<T>({ path, ...options });
  }
  const hasBody = options.body !== undefined;
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    ...(hasBody
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options.body),
        }
      : {}),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Auth request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export function createWsNativeApi(): NativeApi {
  if (instance) {
    if (instance.transport.getState() !== "disposed") {
      return instance.api;
    }
    instance = null;
  }

  const transport = new WsTransport();
  transport.onStateChange((state) => emitWsTransportState(state));
  registerWsPushSubscriptions(transport);
  const api: NativeApi = {
    dialogs: {
      pickFolder: async () => {
        if (window.desktopBridge) return window.desktopBridge.pickFolder();
        return transport.request<string | null>(WS_METHODS.dialogsPickFolder, {});
      },
      saveFile: async (input) => {
        if (window.desktopBridge?.saveFile) {
          return window.desktopBridge.saveFile(input);
        }
        const blob = new Blob([input.contents], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        try {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = input.defaultFilename;
          anchor.click();
        } finally {
          URL.revokeObjectURL(url);
        }
        return null;
      },
      confirm: async (message) => {
        return showConfirmDialogFallback(message);
      },
    },
    terminal: {
      open: (input) => transport.request(WS_METHODS.terminalOpen, input),
      write: (input) => transport.request(WS_METHODS.terminalWrite, input),
      ackOutput: (input) => transport.request(WS_METHODS.terminalAckOutput, input),
      resize: (input) => transport.request(WS_METHODS.terminalResize, input),
      clear: (input) => transport.request(WS_METHODS.terminalClear, input),
      restart: (input) => transport.request(WS_METHODS.terminalRestart, input),
      close: (input) => transport.request(WS_METHODS.terminalClose, input),
      onEvent: (callback) => {
        terminalEventListeners.add(callback);
        return () => {
          terminalEventListeners.delete(callback);
        };
      },
    },
    projects: {
      discoverScripts: (input) => transport.request(WS_METHODS.projectsDiscoverScripts, input),
      listDirectories: (input) => transport.request(WS_METHODS.projectsListDirectories, input),
      searchEntries: (input) => transport.request(WS_METHODS.projectsSearchEntries, input),
      searchLocalEntries: (input) =>
        transport.request(WS_METHODS.projectsSearchLocalEntries, input),
      readFile: (input) => transport.request(WS_METHODS.projectsReadFile, input),
      createLocalFilePreviewGrant: (input) =>
        transport.request(WS_METHODS.projectsCreateLocalFilePreviewGrant, input),
      writeFile: (input) => transport.request(WS_METHODS.projectsWriteFile, input),
      runDevServer: (input) => transport.request(WS_METHODS.projectsRunDevServer, input),
      stopDevServer: (input) => transport.request(WS_METHODS.projectsStopDevServer, input),
      listDevServers: () => transport.request(WS_METHODS.projectsListDevServers),
      onDevServerEvent: (callback) => {
        projectDevServerEventListeners.add(callback);
        return () => {
          projectDevServerEventListeners.delete(callback);
        };
      },
    },
    agentGroup: {
      getConfig: (input) => transport.request(WS_METHODS.agentGroupGetConfig, input),
      getOverview: (input) => transport.request(WS_METHODS.agentGroupGetOverview, input),
      getSession: (input) =>
        remoteReadWithWsFallback(
          () => getRemoteAgentGroupSession(input.sessionId),
          () => transport.request(WS_METHODS.agentGroupGetSession, input),
        ),
      writeContext: (input) => transport.request(WS_METHODS.agentGroupWriteContext, input),
      updateConfig: (input) => transport.request(WS_METHODS.agentGroupUpdateConfig, input),
      updateSession: (input) => transport.request(WS_METHODS.agentGroupUpdateSession, input),
    },
    filesystem: {
      browse: (input) => transport.request(WS_METHODS.filesystemBrowse, input),
    },
    studio: {
      listThreadOutputs: (input) => transport.request(WS_METHODS.studioListThreadOutputs, input),
    },
    shell: {
      openInEditor: (cwd, editor) =>
        transport.request(WS_METHODS.shellOpenInEditor, { cwd, editor }),
      openExternal: async (url) => {
        const externalUrl = requireHttpExternalUrl(url);
        if (window.desktopBridge) {
          const opened = await window.desktopBridge.openExternal(externalUrl);
          if (!opened) {
            throw new Error("Unable to open link.");
          }
          return;
        }

        // Some mobile browsers can return null here even when the tab opens.
        // Avoid false negatives and let the browser handle popup policy.
        window.open(externalUrl, "_blank", "noopener,noreferrer");
      },
      showInFolder: async (path) => {
        if (window.desktopBridge) {
          await window.desktopBridge.showInFolder(path);
        }
        // No-op in browser - this is a desktop-only feature
      },
    },
    git: {
      githubRepository: (input) => transport.request(WS_METHODS.gitGithubRepository, input),
      pull: (input) => transport.request(WS_METHODS.gitPull, input),
      status: (input) => transport.request(WS_METHODS.gitStatus, input),
      readWorkingTreeDiff: (input) => transport.request(WS_METHODS.gitReadWorkingTreeDiff, input),
      summarizeDiff: (input) =>
        transport.request(WS_METHODS.gitSummarizeDiff, input, {
          timeoutMs: null,
        }),
      runStackedAction: (input) =>
        transport.request(WS_METHODS.gitRunStackedAction, input, {
          timeoutMs: null,
        }),
      listBranches: (input) => transport.request(WS_METHODS.gitListBranches, input),
      createWorktree: (input) => transport.request(WS_METHODS.gitCreateWorktree, input),
      createDetachedWorktree: (input) =>
        transport.request(WS_METHODS.gitCreateDetachedWorktree, input),
      removeWorktree: (input) => transport.request(WS_METHODS.gitRemoveWorktree, input),
      createBranch: (input) => transport.request(WS_METHODS.gitCreateBranch, input),
      checkout: (input) => transport.request(WS_METHODS.gitCheckout, input),
      stashAndCheckout: (input) => transport.request(WS_METHODS.gitStashAndCheckout, input),
      stashDrop: (input) => transport.request(WS_METHODS.gitStashDrop, input),
      stashInfo: (input) => transport.request(WS_METHODS.gitStashInfo, input),
      removeIndexLock: (input) => transport.request(WS_METHODS.gitRemoveIndexLock, input),
      init: (input) => transport.request(WS_METHODS.gitInit, input),
      stageFiles: (input) => transport.request(WS_METHODS.gitStageFiles, input),
      unstageFiles: (input) => transport.request(WS_METHODS.gitUnstageFiles, input),
      handoffThread: (input) => transport.request(WS_METHODS.gitHandoffThread, input),
      resolvePullRequest: (input) => transport.request(WS_METHODS.gitResolvePullRequest, input),
      pullRequestSnapshot: (input) => transport.request(WS_METHODS.gitPullRequestSnapshot, input),
      preparePullRequestThread: (input) =>
        transport.request(WS_METHODS.gitPreparePullRequestThread, input),
      onActionProgress: (callback) => {
        gitActionProgressListeners.add(callback);
        return () => {
          gitActionProgressListeners.delete(callback);
        };
      },
    },
    pullRequests: {
      list: (input) => transport.request(WS_METHODS.pullRequestsList, input),
      reviewRequestCount: (input) =>
        transport.request(WS_METHODS.pullRequestsReviewRequestCount, input),
      detail: (input) => transport.request(WS_METHODS.pullRequestsDetail, input),
      diff: (input) => transport.request(WS_METHODS.pullRequestsDiff, input),
      action: (input) =>
        transport.request(WS_METHODS.pullRequestsAction, input, { timeoutMs: null }),
      comment: (input) => transport.request(WS_METHODS.pullRequestsComment, input),
      setPinned: (input) => transport.request(WS_METHODS.pullRequestsSetPinned, input),
    },
    contextMenu: {
      show: async <T extends string>(
        items: readonly ContextMenuItem<T>[],
        position?: { x: number; y: number },
      ): Promise<T | null> => {
        if (window.desktopBridge) {
          return window.desktopBridge.showContextMenu(items, position);
        }
        return showContextMenuFallback(items, position);
      },
    },
    server: {
      getConfig: () => transport.request(WS_METHODS.serverGetConfig),
      getEnvironment: () => transport.request(WS_METHODS.serverGetEnvironment),
      getSettings: () => transport.request(WS_METHODS.serverGetSettings),
      updateSettings: (input) => transport.request(WS_METHODS.serverUpdateSettings, input),
      getRemoteAccessStatus: () =>
        transport.request<RemoteAccessStatus>(WS_METHODS.serverGetRemoteAccessStatus),
      restartRemoteAccess: () =>
        transport.request<RemoteAccessStatus>(WS_METHODS.serverRestartRemoteAccess),
      resetRemoteAccess: () =>
        transport.request<RemoteAccessStatus>(WS_METHODS.serverResetRemoteAccess),
      getAuthSession: () => requestAuthJson<AuthSessionState>("/api/auth/session"),
      bootstrapAuth: (input: AuthBootstrapInput) =>
        requestAuthJson<AuthBootstrapResult>("/api/auth/bootstrap", {
          method: "POST",
          body: input,
        }),
      bootstrapBearerAuth: (input: AuthBootstrapInput) =>
        requestAuthJson<AuthBearerBootstrapResult>("/api/auth/bootstrap/bearer", {
          method: "POST",
          body: input,
        }),
      issueAuthWebSocketToken: () =>
        requestAuthJson<AuthWebSocketTokenResult>("/api/auth/ws-token", { method: "POST" }),
      createAuthPairingToken: (input?: AuthCreatePairingCredentialInput) =>
        requestAuthJson<AuthPairingCredentialResult>("/api/auth/pairing-token", {
          method: "POST",
          ...(input ? { body: input } : {}),
        }),
      listAuthPairingLinks: () =>
        requestAuthJson<ReadonlyArray<AuthPairingLink>>("/api/auth/pairing-links"),
      revokeAuthPairingLink: (input: AuthRevokePairingLinkInput) =>
        requestAuthJson<{ revoked: boolean }>("/api/auth/pairing-links/revoke", {
          method: "POST",
          body: input,
        }),
      listAuthClients: () => requestAuthJson<ReadonlyArray<AuthClientSession>>("/api/auth/clients"),
      revokeAuthClient: (input: AuthRevokeClientSessionInput) =>
        requestAuthJson<{ revoked: boolean }>("/api/auth/clients/revoke", {
          method: "POST",
          body: input,
        }),
      revokeOtherAuthClients: () =>
        requestAuthJson<{ revokedCount: number }>("/api/auth/clients/revoke-others", {
          method: "POST",
        }),
      refreshProviders: () => transport.request(WS_METHODS.serverRefreshProviders),
      // Provider updates run up to 2 minutes server-side; callers wrap this in
      // withProviderUpdateTimeout, which owns the client-side watchdog.
      updateProvider: (input) =>
        transport.request(WS_METHODS.serverUpdateProvider, input, { timeoutMs: null }),
      listWorktrees: () => transport.request(WS_METHODS.serverListWorktrees),
      listLocalServers: () => transport.request(WS_METHODS.serverListLocalServers),
      stopLocalServer: (input) => transport.request(WS_METHODS.serverStopLocalServer, input),
      getProviderUsageSnapshot: (input) =>
        transport.request(WS_METHODS.serverGetProviderUsageSnapshot, input),
      listProviderUsage: (input) => transport.request(WS_METHODS.serverListProviderUsage, input),
      getDiagnostics: () => transport.request(WS_METHODS.serverGetDiagnostics),
      generateThreadRecap: (input) =>
        transport.request(WS_METHODS.serverGenerateThreadRecap, input, {
          timeoutMs: null,
        }),
      generateAutomationIntent: (input) =>
        transport.request(WS_METHODS.serverGenerateAutomationIntent, input, {
          timeoutMs: null,
        }),
      transcribeVoice: (input) => {
        if (window.desktopBridge?.server?.transcribeVoice) {
          return window.desktopBridge.server.transcribeVoice(input);
        }
        return transport.request(WS_METHODS.serverTranscribeVoice, input);
      },
      upsertKeybinding: (input) => transport.request(WS_METHODS.serverUpsertKeybinding, input),
    },
    stats: {
      getProfileStats: (input) => transport.request(WS_METHODS.statsGetProfileStats, input),
      getProfileTokenStats: (input) =>
        transport.request(WS_METHODS.statsGetProfileTokenStats, input),
    },
    provider: {
      getComposerCapabilities: (input) =>
        transport.request(WS_METHODS.providerGetComposerCapabilities, input),
      // Compaction is capped server-side per provider (ACP providers allow up
      // to the 10-minute turn-idle ceiling), so the server owns this bound.
      compactThread: (input) =>
        transport.request(WS_METHODS.providerCompactThread, input, { timeoutMs: null }),
      listCommands: (input) => transport.request(WS_METHODS.providerListCommands, input),
      listSkills: (input) => transport.request(WS_METHODS.providerListSkills, input),
      listSkillsCatalog: (input) => transport.request(WS_METHODS.providerListSkillsCatalog, input),
      listPlugins: (input) => transport.request(WS_METHODS.providerListPlugins, input),
      readPlugin: (input) => transport.request(WS_METHODS.providerReadPlugin, input),
      listModels: (input) => transport.request(WS_METHODS.providerListModels, input),
      listAgents: (input) => transport.request(WS_METHODS.providerListAgents, input),
    },
    orchestration: {
      getSnapshot: () => transport.request(ORCHESTRATION_WS_METHODS.getSnapshot),
      getShellSnapshot: () =>
        remoteReadWithWsFallback(
          () => getRemoteShellSnapshot(),
          () => transport.request(ORCHESTRATION_WS_METHODS.getShellSnapshot),
        ),
      listHighlights: (input) => transport.request(ORCHESTRATION_WS_METHODS.listHighlights, input),
      dispatchCommand: (command) => {
        return transport.request(ORCHESTRATION_WS_METHODS.dispatchCommand, {
          command: omitNullUserInputAnswers(command),
        });
      },
      importThread: (input) => transport.request(ORCHESTRATION_WS_METHODS.importThread, input),
      repairState: () => transport.request(ORCHESTRATION_WS_METHODS.repairState),
      getTurnDiff: (input) => transport.request(ORCHESTRATION_WS_METHODS.getTurnDiff, input),
      getFullThreadDiff: (input) =>
        transport.request(ORCHESTRATION_WS_METHODS.getFullThreadDiff, input),
      replayEvents: (fromSequenceExclusive) =>
        transport.request(ORCHESTRATION_WS_METHODS.replayEvents, {
          fromSequenceExclusive,
        }),
      subscribeShell: () => transport.request<void>(ORCHESTRATION_WS_METHODS.subscribeShell, {}),
      unsubscribeShell: () =>
        transport.request<void>(ORCHESTRATION_WS_METHODS.unsubscribeShell, {}),
      subscribeThread: (input) =>
        transport.request<void>(ORCHESTRATION_WS_METHODS.subscribeThread, input),
      unsubscribeThread: (input) =>
        transport.request<void>(ORCHESTRATION_WS_METHODS.unsubscribeThread, input),
      onShellEvent: (callback) => {
        orchestrationShellEventListeners.add(callback);
        return () => {
          orchestrationShellEventListeners.delete(callback);
        };
      },
      onThreadEvent: (callback) => {
        orchestrationThreadEventListeners.add(callback);
        return () => {
          orchestrationThreadEventListeners.delete(callback);
        };
      },
    },
    automation: {
      list: (input) => transport.request(WS_METHODS.automationList, input),
      create: (input) => transport.request(WS_METHODS.automationCreate, input),
      update: (input) => transport.request(WS_METHODS.automationUpdate, input),
      delete: (input) => transport.request(WS_METHODS.automationDelete, input),
      runNow: (input) => transport.request(WS_METHODS.automationRunNow, input),
      cancelRun: (input) => transport.request(WS_METHODS.automationCancelRun, input),
      markRunRead: (input) => transport.request(WS_METHODS.automationMarkRunRead, input),
      archiveRun: (input) => transport.request(WS_METHODS.automationArchiveRun, input),
      onEvent: (callback) =>
        transport.subscribe(WS_CHANNELS.automationEvent, (message) => callback(message.data)),
    },
    browser: createBrowserApi(),
  };

  instance = { api, transport };
  return api;
}

// Browser-mode tests mount full app roots repeatedly in one page; reset the
// singleton so each test gets a fresh WebSocket stream and cached push state.
export function resetWsNativeApiForTest(): void {
  instance?.transport.dispose();
  instance = null;
  resetWsEventRegistry(true);
  resetFallbackBrowserApi(true);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    instance?.transport.dispose();
    instance = null;
    resetWsEventRegistry(false);
    resetFallbackBrowserApi(false);
  });
}
