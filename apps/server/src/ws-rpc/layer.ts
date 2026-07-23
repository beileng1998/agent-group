import { WsRpcError, WsRpcGroup } from "@agent-group/contracts";
import { Effect, FileSystem, Path } from "effect";

import { AutomationService } from "../automation/Services/AutomationService";
import { CheckpointDiffQuery } from "../checkpointing/Services/CheckpointDiffQuery";
import { ServerConfig } from "../config";
import { DevServerManager } from "../devServerManager";
import { GitCore } from "../git/Services/GitCore";
import { GitManager } from "../git/Services/GitManager";
import { GitStatusBroadcaster } from "../git/Services/GitStatusBroadcaster";
import { TextGeneration } from "../git/Services/TextGeneration";
import { Keybindings } from "../keybindings";
import { Open } from "../open";
import { HighlightsQuery } from "../orchestration/Services/HighlightsQuery";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { ProfileStatsQuery } from "../profileStats";
import { ProviderAdapterRegistry } from "../provider/Services/ProviderAdapterRegistry";
import { ProviderDiscoveryService } from "../provider/Services/ProviderDiscoveryService";
import { ProviderHealth } from "../provider/Services/ProviderHealth";
import { ProviderService } from "../provider/Services/ProviderService";
import { PullRequestService } from "../pullRequests/Services/PullRequestService";
import { RemoteAccess } from "../remoteAccess/Services/RemoteAccess";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment";
import { ServerLifecycleEvents } from "../serverLifecycleEvents";
import { ServerRuntimeStartup } from "../serverRuntimeStartup";
import { ServerSettingsService } from "../serverSettings";
import { TerminalManager } from "../terminal/Services/Manager";
import { WorkspaceEntries } from "../workspace/Services/WorkspaceEntries";
import { WorkspaceFileSystem } from "../workspace/Services/WorkspaceFileSystem";
import { makeWorkspaceSupport } from "../workspace/workspaceSupport";
import { toWsRpcError } from "../wsRpcError";
import { makeDiagnosticsHandlers } from "./diagnostics";
import { makeGitHandlers } from "./gitHandlers";
import { makeOrchestrationHandlers } from "./orchestrationHandlers";
import { makeProviderAutomationHandlers } from "./providerAutomationHandlers";
import { makeServerHandlers } from "./serverHandlers";
import { makeTerminalHandlers } from "./terminalHandlers";
import { makeWorkspaceHandlers } from "./workspaceHandlers";

export const makeWsRpcLayer = () =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const checkpointDiffQuery = yield* CheckpointDiffQuery;
      const automationService = yield* AutomationService;
      const config = yield* ServerConfig;
      const devServerManager = yield* DevServerManager;
      const fileSystem = yield* FileSystem.FileSystem;
      const git = yield* GitCore;
      const gitManager = yield* GitManager;
      const gitStatusBroadcaster = yield* GitStatusBroadcaster;
      const keybindings = yield* Keybindings;
      const open = yield* Open;
      const orchestrationEngine = yield* OrchestrationEngineService;
      const path = yield* Path.Path;
      const pullRequests = yield* PullRequestService;
      const remoteAccess = yield* RemoteAccess;
      const profileStatsQuery = yield* ProfileStatsQuery;
      const projectionReadModelQuery = yield* ProjectionSnapshotQuery;
      const highlightsQuery = yield* HighlightsQuery;
      const providerAdapterRegistry = yield* ProviderAdapterRegistry;
      const providerDiscoveryService = yield* ProviderDiscoveryService;
      const providerHealth = yield* ProviderHealth;
      const providerService = yield* ProviderService;
      const lifecycleEvents = yield* ServerLifecycleEvents;
      const runtimeStartup = yield* ServerRuntimeStartup;
      const serverEnvironment = yield* ServerEnvironment;
      const serverSettings = yield* ServerSettingsService;
      const terminalManager = yield* TerminalManager;
      const textGeneration = yield* TextGeneration;
      const workspaceEntries = yield* WorkspaceEntries;
      const workspaceFileSystem = yield* WorkspaceFileSystem;

      const rpcEffect = <A, E, R>(effect: Effect.Effect<A, E, R>, fallbackMessage: string) =>
        effect.pipe(Effect.mapError((cause) => toWsRpcError(cause, fallbackMessage)));
      const workspaceSupport = makeWorkspaceSupport({ config, fileSystem, path });

      return WsRpcGroup.of({
        ...makeWorkspaceHandlers({
          config,
          devServerManager,
          open,
          projectionReadModelQuery,
          serverSettings,
          workspaceEntries,
          workspaceFileSystem,
          workspaceSupport,
          rpcEffect,
        }),
        ...makeOrchestrationHandlers({
          checkpointDiffQuery,
          config,
          fileSystem,
          orchestrationEngine,
          path,
          projectionReadModelQuery,
          highlightsQuery,
          providerAdapterRegistry,
          providerService,
          runtimeStartup,
          workspaceSupport,
          rpcEffect,
        }),
        ...makeGitHandlers({
          git,
          gitManager,
          gitStatusBroadcaster,
          pullRequests,
          rpcEffect,
        }),
        ...makeTerminalHandlers({ orchestrationEngine, terminalManager, rpcEffect }),
        ...makeServerHandlers({
          config,
          devServerManager,
          keybindings,
          lifecycleEvents,
          profileStatsQuery,
          providerAdapterRegistry,
          providerHealth,
          remoteAccess,
          serverEnvironment,
          serverSettings,
          textGeneration,
          rpcEffect,
        }),
        ...makeDiagnosticsHandlers({ projectionReadModelQuery, rpcEffect }),
        ...makeProviderAutomationHandlers({
          automationService,
          config,
          providerDiscoveryService,
          providerService,
          rpcEffect,
        }),
      });
    }),
  );
