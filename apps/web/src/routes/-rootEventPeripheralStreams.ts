import { ThreadId, type NativeApi, type ServerConfig } from "@agent-group/contracts";
import { defaultTerminalTitleForCliKind } from "@agent-group/shared/terminalThreads";
import { type QueryClient } from "@tanstack/react-query";

import { toastManager } from "../components/ui/toast";
import { resolveAndPersistPreferredEditor } from "../editorPreferences";
import { providerModelDiscoveryInvalidationFingerprint } from "../lib/providerDiscoveryInvalidation";
import { providerDiscoveryQueryKeys } from "../lib/providerDiscoveryReactQuery";
import {
  serverConfigQueryOptions,
  serverQueryKeys,
  serverSettingsQueryOptions,
} from "../lib/serverReactQuery";
import { useProjectRunStore } from "../projectRunStore";
import { useStore } from "../store";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { terminalActivityFromEvent } from "../terminalActivity";
import { useWorkspaceStore } from "../workspaceStore";
import {
  onServerConfigUpdated,
  onServerProviderStatusesUpdated,
  onServerSettingsUpdated,
  onServerWelcome,
} from "../wsNativeApi";

export function subscribeRootEventPeripheralStreams(input: {
  readonly api: NativeApi;
  readonly queryClient: QueryClient;
  readonly isDisposed: () => boolean;
  readonly ensureScopedSubscriptions: () => Promise<void>;
  readonly loadShellSnapshotOnce: () => Promise<void>;
  readonly getPathname: () => string;
  readonly hasHandledBootstrapThread: (threadId: ThreadId) => boolean;
  readonly markBootstrapThreadHandled: (threadId: ThreadId) => void;
  readonly navigateToThread: (threadId: ThreadId) => Promise<void>;
}): () => void {
  let providerDiscoveryFingerprint: string | null = null;

  const unsubTerminalEvent = input.api.terminal.onEvent((event) => {
    const terminalThreadId = ThreadId.makeUnsafe(event.threadId);
    if (event.type === "activity") {
      const terminalStore = useTerminalStateStore.getState();
      const currentCliKind =
        selectThreadTerminalState(terminalStore.terminalStateByThreadId, terminalThreadId)
          .terminalCliKindsById[event.terminalId] ?? null;
      if (event.cliKind || currentCliKind !== null) {
        terminalStore.setTerminalMetadata(terminalThreadId, event.terminalId, {
          cliKind: event.cliKind,
          label: event.cliKind ? defaultTerminalTitleForCliKind(event.cliKind) : "Terminal",
        });
      }
    }
    const activity = terminalActivityFromEvent(event);
    if (activity === null) return;
    useTerminalStateStore.getState().setTerminalActivity(terminalThreadId, event.terminalId, {
      hasRunningSubprocess: activity.hasRunningSubprocess,
      agentState: activity.agentState,
    });
  });

  const invalidateLocalServers = () => {
    void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.localServers() });
  };
  const unsubDevServerEvent = input.api.projects.onDevServerEvent((event) => {
    const store = useProjectRunStore.getState();
    if (event.type === "snapshot") store.replaceAll(event.servers);
    else if (event.type === "upserted") store.upsertRun(event.server);
    else store.removeRun(event.projectId);
    invalidateLocalServers();
  });
  void input.api.projects
    .listDevServers()
    .then(({ servers }) => {
      if (input.isDisposed()) return;
      useProjectRunStore.getState().replaceAll(servers);
      invalidateLocalServers();
    })
    .catch(() => undefined);

  const unsubWelcome = onServerWelcome((payload) => {
    void (async () => {
      useWorkspaceStore.getState().setServerWorkspacePaths({
        homeDir: payload.homeDir,
        chatWorkspaceRoot: payload.chatWorkspaceRoot,
        studioWorkspaceRoot: payload.studioWorkspaceRoot,
      });
      await input.ensureScopedSubscriptions();
      if (input.isDisposed()) return;
      await input.loadShellSnapshotOnce();
      if (!payload.bootstrapProjectId || !payload.bootstrapThreadId) return;
      useStore.getState().setProjectExpanded(payload.bootstrapProjectId, true);
      if (input.getPathname() !== "/") return;
      if (input.hasHandledBootstrapThread(payload.bootstrapThreadId)) return;
      await input.navigateToThread(payload.bootstrapThreadId);
      input.markBootstrapThreadHandled(payload.bootstrapThreadId);
    })().catch(() => undefined);
  });

  let subscribed = false;
  const unsubServerConfigUpdated = onServerConfigUpdated((payload) => {
    void input.queryClient.invalidateQueries({ queryKey: serverQueryKeys.config() });
    if (!subscribed) return;
    const issue = payload.issues.find((entry) => entry.kind.startsWith("keybindings."));
    if (!issue) return;
    toastManager.add({
      type: "warning",
      title: "Invalid keybindings configuration",
      description: issue.message,
      actionProps: {
        children: "Open keybindings.json",
        onClick: () => {
          void input.queryClient
            .ensureQueryData(serverConfigQueryOptions())
            .then((config) => {
              const editor = resolveAndPersistPreferredEditor(config.availableEditors);
              if (!editor) throw new Error("No available editors found.");
              return input.api.shell.openInEditor(config.keybindingsConfigPath, editor);
            })
            .catch((error) => {
              toastManager.add({
                type: "error",
                title: "Unable to open keybindings file",
                description: error instanceof Error ? error.message : "Unknown error opening file.",
              });
            });
        },
      },
    });
  });

  const unsubProviderStatusesUpdated = onServerProviderStatusesUpdated((payload) => {
    const nextFingerprint = providerModelDiscoveryInvalidationFingerprint(payload.providers);
    const currentConfig = input.queryClient.getQueryData<ServerConfig>(serverQueryKeys.config());
    const previousFingerprint =
      providerDiscoveryFingerprint ??
      (currentConfig
        ? providerModelDiscoveryInvalidationFingerprint(currentConfig.providers)
        : null);
    const shouldInvalidateDiscovery =
      previousFingerprint !== null && previousFingerprint !== nextFingerprint;
    providerDiscoveryFingerprint = nextFingerprint;
    if (!currentConfig) {
      void input.queryClient.fetchQuery(serverConfigQueryOptions()).catch(() => undefined);
      return;
    }
    input.queryClient.setQueryData(serverQueryKeys.config(), {
      ...currentConfig,
      providers: payload.providers,
    });
    if (!shouldInvalidateDiscovery) return;
    void input.queryClient.invalidateQueries({
      queryKey: ["provider-discovery", "models", "kilo"],
    });
    void input.queryClient.invalidateQueries({
      queryKey: ["provider-discovery", "models", "opencode"],
    });
    void input.queryClient.invalidateQueries({
      queryKey: ["provider-discovery", "models", "cursor"],
    });
    void input.queryClient.invalidateQueries({
      queryKey: providerDiscoveryQueryKeys.agentsForProvider("kilo"),
    });
    void input.queryClient.invalidateQueries({
      queryKey: providerDiscoveryQueryKeys.agentsForProvider("opencode"),
    });
  });

  const unsubServerSettingsUpdated = onServerSettingsUpdated((payload) => {
    input.queryClient.setQueryData(serverQueryKeys.settings(), payload.settings);
    void input.queryClient.invalidateQueries({ queryKey: serverSettingsQueryOptions().queryKey });
  });
  subscribed = true;

  return () => {
    unsubTerminalEvent();
    unsubDevServerEvent();
    unsubWelcome();
    unsubServerConfigUpdated();
    unsubProviderStatusesUpdated();
    unsubServerSettingsUpdated();
  };
}
