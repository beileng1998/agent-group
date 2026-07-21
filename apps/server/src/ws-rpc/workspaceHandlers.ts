import { WS_METHODS, WsRpcError, type ProjectDevServerEvent } from "@agent-group/contracts";
import { Effect, Option, Stream } from "effect";

import {
  getAgentGroupConfig,
  getAgentGroupOverview,
  getAgentGroupSession,
  updateAgentGroupConfig,
  updateAgentGroupSession,
  writeAgentGroupContext,
} from "../agentGroup/runtime";
import {
  resolveAgentGroupConfigCoordinates,
  resolveAgentGroupSessionCoordinates,
} from "../agentGroup/coordinates";
import { ServerConfig } from "../config";
import { DevServerManager } from "../devServerManager";
import { Open } from "../open";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { pickHostFolder } from "../hostFolderPicker";
import { createLocalPreviewGrant } from "../localImageFiles";
import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils";
import type { ServerSettingsService } from "../serverSettings";
import { listStudioThreadOutputs } from "../studioOutputs";
import { WorkspaceEntries } from "../workspace/Services/WorkspaceEntries";
import { WorkspaceFileSystem } from "../workspace/Services/WorkspaceFileSystem";
import { bufferLiveUiStream } from "../wsStreamBackpressure";
import { failLiveUiStreamForSnapshotResync } from "./streamSupport";
import type { WsRpcHandlers } from "./types";
import type { WorkspaceSupport } from "./workspaceSupport";

export function makeWorkspaceHandlers(dependencies: {
  readonly config: typeof ServerConfig.Service;
  readonly devServerManager: typeof DevServerManager.Service;
  readonly open: typeof Open.Service;
  readonly projectionReadModelQuery: typeof ProjectionSnapshotQuery.Service;
  readonly serverSettings: typeof ServerSettingsService.Service;
  readonly workspaceEntries: typeof WorkspaceEntries.Service;
  readonly workspaceFileSystem: typeof WorkspaceFileSystem.Service;
  readonly workspaceSupport: WorkspaceSupport;
  readonly rpcEffect: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    fallbackMessage: string,
  ) => Effect.Effect<A, WsRpcError, R>;
}) {
  return {
    [WS_METHODS.dialogsPickFolder]: () =>
      dependencies.rpcEffect(
        Effect.tryPromise(() => pickHostFolder()),
        "Failed to open folder picker",
      ),
    [WS_METHODS.agentGroupGetConfig]: (input) =>
      dependencies.rpcEffect(
        Effect.gen(function* () {
          const settings = yield* dependencies.serverSettings.getSettings;
          const coordinates = yield* resolveAgentGroupConfigCoordinates(
            dependencies.projectionReadModelQuery,
            input.groupId,
          );
          return yield* Effect.tryPromise(() =>
            getAgentGroupConfig({ ...coordinates, globalSettings: settings.agentGroup }),
          );
        }),
        "Failed to load Agent Group settings",
      ),
    [WS_METHODS.agentGroupGetOverview]: (input) =>
      dependencies.rpcEffect(
        Effect.gen(function* () {
          const settings = yield* dependencies.serverSettings.getSettings;
          const coordinates = yield* resolveAgentGroupConfigCoordinates(
            dependencies.projectionReadModelQuery,
            input.groupId,
          );
          return yield* Effect.tryPromise(() =>
            getAgentGroupOverview({ ...coordinates, globalSettings: settings.agentGroup }),
          );
        }),
        "Failed to load Agent Group overview",
      ),
    [WS_METHODS.agentGroupGetSession]: (input) =>
      dependencies.rpcEffect(
        Effect.gen(function* () {
          const settings = yield* dependencies.serverSettings.getSettings;
          const coordinates = yield* resolveAgentGroupSessionCoordinates(
            dependencies.projectionReadModelQuery,
            input.sessionId,
          );
          return yield* Effect.tryPromise(() =>
            getAgentGroupSession({ ...coordinates, globalSettings: settings.agentGroup }),
          );
        }),
        "Failed to load Agent Group session context",
      ),
    [WS_METHODS.agentGroupWriteContext]: (input) =>
      dependencies.rpcEffect(
        Effect.gen(function* () {
          const settings = yield* dependencies.serverSettings.getSettings;
          const coordinates = yield* resolveAgentGroupSessionCoordinates(
            dependencies.projectionReadModelQuery,
            input.sessionId,
          );
          return yield* Effect.tryPromise(() =>
            writeAgentGroupContext({
              ...coordinates,
              ...input,
              globalSettings: settings.agentGroup,
            }),
          );
        }),
        "Failed to save Agent Group session context",
      ),
    [WS_METHODS.agentGroupUpdateConfig]: (input) =>
      dependencies.rpcEffect(
        Effect.gen(function* () {
          const settings = yield* dependencies.serverSettings.getSettings;
          const coordinates = yield* resolveAgentGroupConfigCoordinates(
            dependencies.projectionReadModelQuery,
            input.groupId,
          );
          return yield* Effect.tryPromise(() =>
            updateAgentGroupConfig({
              ...coordinates,
              ...input,
              globalSettings: settings.agentGroup,
            }),
          );
        }),
        "Failed to update Agent Group settings",
      ),
    [WS_METHODS.agentGroupUpdateSession]: (input) =>
      dependencies.rpcEffect(
        Effect.gen(function* () {
          const settings = yield* dependencies.serverSettings.getSettings;
          const coordinates = yield* resolveAgentGroupSessionCoordinates(
            dependencies.projectionReadModelQuery,
            input.sessionId,
          );
          return yield* Effect.tryPromise(() =>
            updateAgentGroupSession({
              ...coordinates,
              ...input,
              globalSettings: settings.agentGroup,
            }),
          );
        }),
        "Failed to update Agent Group session settings",
      ),
    [WS_METHODS.projectsListDirectories]: (input) =>
      dependencies.rpcEffect(
        dependencies.workspaceEntries.listDirectories(input),
        "Failed to list workspace directories",
      ),
    [WS_METHODS.projectsSearchEntries]: (input) =>
      dependencies.rpcEffect(
        dependencies.workspaceEntries.search(input),
        "Failed to search workspace entries",
      ),
    [WS_METHODS.projectsDiscoverScripts]: (input) =>
      dependencies.rpcEffect(
        dependencies.workspaceEntries.discoverScripts(input),
        "Failed to discover project scripts",
      ),
    [WS_METHODS.projectsSearchLocalEntries]: (input) =>
      dependencies.rpcEffect(
        dependencies.workspaceEntries.searchLocal(input),
        "Failed to search local entries",
      ),
    [WS_METHODS.projectsReadFile]: (input) =>
      dependencies.rpcEffect(
        dependencies.workspaceFileSystem.readFile(input),
        "Failed to read workspace file",
      ),
    [WS_METHODS.projectsCreateLocalFilePreviewGrant]: (input) =>
      dependencies.rpcEffect(
        Effect.promise(() => createLocalPreviewGrant({ requestedPath: input.path })),
        "Failed to create local file preview grant",
      ),
    [WS_METHODS.projectsWriteFile]: (input) =>
      dependencies.rpcEffect(
        dependencies.workspaceFileSystem.writeFile(input),
        "Failed to write workspace file",
      ),
    [WS_METHODS.projectsRunDevServer]: (input) =>
      dependencies.rpcEffect(
        dependencies.devServerManager.run(input),
        "Failed to start dev server",
      ),
    [WS_METHODS.projectsStopDevServer]: (input) =>
      dependencies.rpcEffect(
        dependencies.devServerManager.stop(input),
        "Failed to stop dev server",
      ),
    [WS_METHODS.projectsListDevServers]: () =>
      dependencies.rpcEffect(dependencies.devServerManager.list, "Failed to list dev servers"),
    [WS_METHODS.subscribeProjectDevServerEvents]: () =>
      Stream.concat(
        Stream.fromEffect(
          dependencies.devServerManager.list.pipe(
            Effect.map(
              (result): ProjectDevServerEvent => ({ type: "snapshot", servers: result.servers }),
            ),
          ),
        ),
        bufferLiveUiStream(dependencies.devServerManager.stream, {
          label: "projects.dev-servers",
          onDroppedEvents: failLiveUiStreamForSnapshotResync,
        }),
      ),
    [WS_METHODS.studioListThreadOutputs]: (input) =>
      dependencies.rpcEffect(
        Effect.gen(function* () {
          yield* dependencies.workspaceSupport
            .prepareStudioWorkspaceRoot(dependencies.config.studioWorkspaceRoot)
            .pipe(Effect.catch(() => Effect.void));
          const context = yield* dependencies.projectionReadModelQuery.getThreadCheckpointContext(
            input.threadId,
            { includeFileChangeActivityPayloads: true },
          );
          if (Option.isNone(context) || context.value.projectKind !== "studio") {
            return { entries: [] };
          }
          const workspaceCwd = resolveThreadWorkspaceCwd({
            thread: {
              projectId: context.value.projectId,
              envMode: context.value.envMode,
              worktreePath: context.value.worktreePath,
            },
            projects: [
              {
                id: context.value.projectId,
                kind: context.value.projectKind,
                workspaceRoot: context.value.workspaceRoot,
              },
            ],
          });
          if (!workspaceCwd) return { entries: [] };
          return yield* listStudioThreadOutputs({
            workspaceRoot: workspaceCwd,
            checkpoints: context.value.checkpoints,
            ...(context.value.fileChangeActivityPayloads
              ? { fileChangeActivityPayloads: context.value.fileChangeActivityPayloads }
              : {}),
          });
        }),
        "Failed to list studio thread outputs",
      ),
    [WS_METHODS.filesystemBrowse]: (input) =>
      dependencies.rpcEffect(
        dependencies.workspaceEntries.browse(input),
        "Failed to browse filesystem",
      ),
    [WS_METHODS.shellOpenInEditor]: (input) =>
      dependencies.rpcEffect(dependencies.open.openInEditor(input), "Failed to open editor"),
  } satisfies Partial<WsRpcHandlers>;
}
