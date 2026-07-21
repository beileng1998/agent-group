import {
  WS_METHODS,
  WsRpcError,
  type ServerConfigStreamEvent,
  type ServerLifecycleStreamEvent,
} from "@agent-group/contracts";
import { Effect, Stream } from "effect";

import { DevServerManager } from "../devServerManager";
import { findProjectDevServerForLocalServer } from "../devServerManager";
import { ServerConfig } from "../config";
import { Keybindings } from "../keybindings";
import { listLocalServers, stopLocalServer } from "../localServerMonitor";
import { resolveAvailableEditors } from "../open";
import { ProfileStatsQuery } from "../profileStats";
import { ProviderAdapterRegistry } from "../provider/Services/ProviderAdapterRegistry";
import { ProviderHealth } from "../provider/Services/ProviderHealth";
import { listProviderUsage } from "../providerUsage";
import { getProviderUsageSnapshot } from "../providerUsageSnapshot";
import { RemoteAccess } from "../remoteAccess/Services/RemoteAccess";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment";
import { ServerLifecycleEvents } from "../serverLifecycleEvents";
import { ServerSettingsService } from "../serverSettings";
import { TextGeneration } from "../git/Services/TextGeneration";
import { bufferLiveUiStream } from "../wsStreamBackpressure";
import { toWsRpcError } from "../wsRpcError";
import { failLiveUiStreamForSnapshotResync } from "./streamSupport";
import type { WsRpcHandlers } from "./types";

export function makeServerHandlers(dependencies: {
  readonly config: typeof ServerConfig.Service;
  readonly devServerManager: typeof DevServerManager.Service;
  readonly keybindings: typeof Keybindings.Service;
  readonly lifecycleEvents: typeof ServerLifecycleEvents.Service;
  readonly profileStatsQuery: typeof ProfileStatsQuery.Service;
  readonly providerAdapterRegistry: typeof ProviderAdapterRegistry.Service;
  readonly providerHealth: typeof ProviderHealth.Service;
  readonly remoteAccess: typeof RemoteAccess.Service;
  readonly serverEnvironment: typeof ServerEnvironment.Service;
  readonly serverSettings: typeof ServerSettingsService.Service;
  readonly textGeneration: typeof TextGeneration.Service;
  readonly rpcEffect: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    fallbackMessage: string,
  ) => Effect.Effect<A, WsRpcError, R>;
}) {
  const loadServerConfig = Effect.gen(function* () {
    const keybindingsConfig = yield* dependencies.keybindings.loadConfigState;
    const providerStatuses = yield* dependencies.providerHealth.getStatuses;
    return {
      cwd: dependencies.config.cwd,
      homeDir: dependencies.config.homeDir,
      chatWorkspaceRoot: dependencies.config.chatWorkspaceRoot,
      studioWorkspaceRoot: dependencies.config.studioWorkspaceRoot,
      worktreesDir: dependencies.config.worktreesDir,
      keybindingsConfigPath: dependencies.config.keybindingsConfigPath,
      keybindings: keybindingsConfig.keybindings,
      issues: keybindingsConfig.issues,
      providers: providerStatuses,
      availableEditors: resolveAvailableEditors(),
    };
  });

  const stopLocalServerAndTrackedProjectRun = Effect.fnUntraced(function* (input: {
    pid: number;
    port: number;
  }) {
    const localServerSnapshot = yield* Effect.promise(() => listLocalServers());
    const localServer =
      localServerSnapshot.servers.find(
        (server) => server.pid === input.pid && server.ports.includes(input.port),
      ) ?? null;
    const result = yield* Effect.promise(() => stopLocalServer(input, localServer));
    if (localServer?.isStoppable) {
      const devServers = yield* dependencies.devServerManager.list;
      const trackedServer = findProjectDevServerForLocalServer({
        localServer,
        devServers: devServers.servers,
      });
      if (trackedServer) {
        yield* dependencies.devServerManager
          .stop({ projectId: trackedServer.projectId })
          .pipe(Effect.catch(() => Effect.void));
      }
    }
    return result;
  });

  return {
    [WS_METHODS.serverGetConfig]: () =>
      dependencies.rpcEffect(loadServerConfig, "Failed to load server config"),
    [WS_METHODS.serverGetEnvironment]: () =>
      dependencies.rpcEffect(
        dependencies.serverEnvironment.getDescriptor,
        "Failed to load server environment",
      ),
    [WS_METHODS.serverGetSettings]: () =>
      dependencies.rpcEffect(
        dependencies.serverSettings.getSettings,
        "Failed to load server settings",
      ),
    [WS_METHODS.serverUpdateSettings]: (input) =>
      dependencies.rpcEffect(
        dependencies.serverSettings.updateSettings(input),
        "Failed to update server settings",
      ),
    [WS_METHODS.serverGetRemoteAccessStatus]: () =>
      dependencies.rpcEffect(
        dependencies.remoteAccess.getStatus,
        "Failed to load remote access status",
      ),
    [WS_METHODS.serverRestartRemoteAccess]: () =>
      dependencies.rpcEffect(dependencies.remoteAccess.restart, "Failed to restart remote access"),
    [WS_METHODS.serverResetRemoteAccess]: () =>
      dependencies.rpcEffect(dependencies.remoteAccess.reset, "Failed to reset remote access"),
    [WS_METHODS.serverRefreshProviders]: () =>
      dependencies.rpcEffect(
        dependencies.providerHealth.refresh.pipe(Effect.map((providers) => ({ providers }))),
        "Failed to refresh providers",
      ),
    [WS_METHODS.serverUpdateProvider]: (input) => dependencies.providerHealth.updateProvider(input),
    [WS_METHODS.serverListWorktrees]: () => Effect.succeed({ worktrees: [] }),
    [WS_METHODS.serverListLocalServers]: () =>
      dependencies.rpcEffect(
        Effect.promise(() => listLocalServers()),
        "Failed to list local servers",
      ),
    [WS_METHODS.serverStopLocalServer]: (input) =>
      dependencies.rpcEffect(
        stopLocalServerAndTrackedProjectRun(input),
        "Failed to stop local server",
      ),
    [WS_METHODS.statsGetProfileStats]: (input) =>
      dependencies.rpcEffect(
        dependencies.profileStatsQuery.getProfileStats(input),
        "Failed to load profile stats",
      ),
    [WS_METHODS.statsGetProfileTokenStats]: (input) =>
      dependencies.rpcEffect(
        dependencies.profileStatsQuery.getProfileTokenStats(input),
        "Failed to load profile token stats",
      ),
    [WS_METHODS.serverGetProviderUsageSnapshot]: (input) =>
      dependencies.rpcEffect(getProviderUsageSnapshot(input), "Failed to load provider usage"),
    [WS_METHODS.serverListProviderUsage]: (input) =>
      dependencies.rpcEffect(listProviderUsage(input), "Failed to load provider usage"),
    [WS_METHODS.serverTranscribeVoice]: (input) =>
      dependencies.rpcEffect(
        dependencies.providerAdapterRegistry
          .getByProvider(input.provider)
          .pipe(
            Effect.flatMap((adapter) =>
              adapter.transcribeVoice
                ? adapter.transcribeVoice(input)
                : Effect.fail(
                    new Error(
                      `Voice transcription is unavailable for provider '${input.provider}'.`,
                    ),
                  ),
            ),
          ),
        "Voice transcription failed",
      ),
    [WS_METHODS.serverGenerateThreadRecap]: (input) =>
      dependencies.rpcEffect(
        Effect.gen(function* () {
          const settings = yield* dependencies.serverSettings.getSettings;
          const modelSelection =
            input.textGenerationModelSelection ?? settings.textGenerationModelSelection;
          return yield* dependencies.textGeneration.generateThreadRecap({
            cwd: input.cwd,
            newMaterial: input.newMaterial,
            ...(input.previousRecap ? { previousRecap: input.previousRecap } : {}),
            ...(input.currentState ? { currentState: input.currentState } : {}),
            ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
            model: input.textGenerationModel ?? modelSelection.model,
            modelSelection,
            ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
          });
        }),
        "Failed to generate thread recap",
      ),
    [WS_METHODS.serverGenerateAutomationIntent]: (input) =>
      dependencies.rpcEffect(
        Effect.gen(function* () {
          const settings = yield* dependencies.serverSettings.getSettings;
          const modelSelection =
            input.textGenerationModelSelection ?? settings.textGenerationModelSelection;
          return yield* dependencies.textGeneration.generateAutomationIntent({
            cwd: input.cwd,
            message: input.message,
            ...(input.defaultMode ? { defaultMode: input.defaultMode } : {}),
            nowIso: input.nowIso,
            ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
            model: input.textGenerationModel ?? modelSelection.model,
            modelSelection,
            ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
          });
        }),
        "Failed to generate automation intent",
      ),
    [WS_METHODS.serverUpsertKeybinding]: (input) =>
      dependencies.rpcEffect(
        dependencies.keybindings
          .upsertKeybindingRule(input)
          .pipe(
            Effect.map((keybindingsConfig) => ({ keybindings: keybindingsConfig, issues: [] })),
          ),
        "Failed to update keybinding",
      ),
    [WS_METHODS.subscribeServerLifecycle]: () =>
      Stream.concat(
        Stream.fromEffect(
          dependencies.lifecycleEvents.snapshot.pipe(
            Effect.map((snapshot) =>
              Array.from(snapshot.events).toSorted((left, right) => left.sequence - right.sequence),
            ),
          ),
        ).pipe(Stream.flatMap(Stream.fromIterable)),
        bufferLiveUiStream(dependencies.lifecycleEvents.stream, {
          label: "server.lifecycle",
          onDroppedEvents: failLiveUiStreamForSnapshotResync,
        }),
      ).pipe(
        Stream.map(
          (event): ServerLifecycleStreamEvent =>
            event.type === "welcome"
              ? { type: "welcome", payload: event.payload }
              : event.type === "ready"
                ? { type: "ready", payload: event.payload }
                : { type: "maintenance", payload: event.payload },
        ),
      ),
    [WS_METHODS.subscribeServerConfig]: () =>
      Stream.concat(
        Stream.fromEffect(
          loadServerConfig.pipe(
            Effect.map((config): ServerConfigStreamEvent => ({ type: "snapshot", config })),
          ),
        ),
        Stream.merge(
          bufferLiveUiStream(dependencies.keybindings.streamChanges, {
            label: "server.keybindings",
            onDroppedEvents: failLiveUiStreamForSnapshotResync,
          }).pipe(
            Stream.map((event) => ({
              type: "configUpdated" as const,
              payload: { issues: event.issues, providers: [] },
            })),
          ),
          Stream.merge(
            bufferLiveUiStream(dependencies.providerHealth.streamChanges, {
              label: "server.provider-statuses",
              onDroppedEvents: failLiveUiStreamForSnapshotResync,
            }).pipe(
              Stream.map((providers) => ({
                type: "providerStatuses" as const,
                payload: { providers },
              })),
            ),
            bufferLiveUiStream(dependencies.serverSettings.streamChanges, {
              label: "server.settings",
              onDroppedEvents: failLiveUiStreamForSnapshotResync,
            }).pipe(
              Stream.map((settings) => ({
                type: "settingsUpdated" as const,
                payload: { settings },
              })),
            ),
          ),
        ),
      ).pipe(Stream.mapError((cause) => toWsRpcError(cause, "Server config stream failed"))),
    [WS_METHODS.subscribeServerProviderStatuses]: () =>
      Stream.concat(
        Stream.fromEffect(
          dependencies.providerHealth.getStatuses.pipe(Effect.map((providers) => ({ providers }))),
        ),
        bufferLiveUiStream(dependencies.providerHealth.streamChanges, {
          label: "server.provider-statuses",
          onDroppedEvents: failLiveUiStreamForSnapshotResync,
        }).pipe(Stream.map((providers) => ({ providers }))),
      ),
    [WS_METHODS.subscribeServerSettings]: () =>
      Stream.concat(
        Stream.fromEffect(
          dependencies.serverSettings.getSettings.pipe(Effect.map((settings) => ({ settings }))),
        ),
        bufferLiveUiStream(dependencies.serverSettings.streamChanges, {
          label: "server.settings",
          onDroppedEvents: failLiveUiStreamForSnapshotResync,
        }).pipe(Stream.map((settings) => ({ settings }))),
      ).pipe(Stream.mapError((cause) => toWsRpcError(cause, "Server settings stream failed"))),
  } satisfies Partial<WsRpcHandlers>;
}
