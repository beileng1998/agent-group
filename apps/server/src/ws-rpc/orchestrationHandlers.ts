import {
  ORCHESTRATION_WS_METHODS,
  WsRpcError,
  type OrchestrationThreadStreamItem,
} from "@agent-group/contracts";
import { clamp } from "effect/Number";
import { Effect, FileSystem, Option, Path, Stream } from "effect";

import { CheckpointDiffQuery } from "../checkpointing/Services/CheckpointDiffQuery";
import { ServerConfig } from "../config";
import { makeOrchestrationCommandDispatcher } from "../orchestration/commandDispatcher";
import { makeImportThreadHandler } from "../orchestration/importThreadRoute";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { HighlightsQuery } from "../orchestration/Services/HighlightsQuery";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { ProviderAdapterRegistry } from "../provider/Services/ProviderAdapterRegistry";
import { ProviderService } from "../provider/Services/ProviderService";
import { ServerRuntimeStartup } from "../serverRuntimeStartup";
import { bufferLiveUiStream } from "../wsStreamBackpressure";
import { toWsRpcError } from "../wsRpcError";
import {
  failLiveUiStreamForSnapshotResync,
  isShellRelevantEvent,
  isThreadDetailEventFor,
  makeShellStreamProjector,
} from "./streamSupport";
import type { WorkspaceSupport } from "../workspace/workspaceSupport";
import type { WsRpcHandlers } from "./types";

export function makeOrchestrationHandlers(dependencies: {
  readonly checkpointDiffQuery: typeof CheckpointDiffQuery.Service;
  readonly config: typeof ServerConfig.Service;
  readonly fileSystem: FileSystem.FileSystem;
  readonly orchestrationEngine: typeof OrchestrationEngineService.Service;
  readonly path: Path.Path;
  readonly projectionReadModelQuery: typeof ProjectionSnapshotQuery.Service;
  readonly highlightsQuery: typeof HighlightsQuery.Service;
  readonly providerAdapterRegistry: typeof ProviderAdapterRegistry.Service;
  readonly providerService: typeof ProviderService.Service;
  readonly runtimeStartup: typeof ServerRuntimeStartup.Service;
  readonly workspaceSupport: WorkspaceSupport;
  readonly rpcEffect: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    fallbackMessage: string,
  ) => Effect.Effect<A, WsRpcError, R>;
}) {
  const dispatchCommand = makeOrchestrationCommandDispatcher({
    config: dependencies.config,
    fileSystem: dependencies.fileSystem,
    orchestrationEngine: dependencies.orchestrationEngine,
    path: dependencies.path,
    runtimeStartup: dependencies.runtimeStartup,
    workspaceSupport: dependencies.workspaceSupport,
  });

  const importThread = makeImportThreadHandler({
    fileSystem: dependencies.fileSystem,
    orchestrationEngine: dependencies.orchestrationEngine,
    path: dependencies.path,
    platform: process.platform,
    projectionSnapshotQuery: dependencies.projectionReadModelQuery,
    providerAdapterRegistry: dependencies.providerAdapterRegistry,
    providerService: dependencies.providerService,
  });
  const toShellStreamEvent = makeShellStreamProjector(dependencies.projectionReadModelQuery);

  return {
    [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
      dependencies.rpcEffect(dispatchCommand(command), "Failed to dispatch orchestration command"),
    [ORCHESTRATION_WS_METHODS.importThread]: (input) =>
      dependencies.rpcEffect(importThread(input), "Failed to import thread"),
    [ORCHESTRATION_WS_METHODS.getSnapshot]: () =>
      dependencies.rpcEffect(
        dependencies.projectionReadModelQuery.getSnapshot(),
        "Failed to load orchestration snapshot",
      ),
    [ORCHESTRATION_WS_METHODS.getShellSnapshot]: () =>
      dependencies.rpcEffect(
        dependencies.projectionReadModelQuery.getShellSnapshot(),
        "Failed to load orchestration shell snapshot",
      ),
    [ORCHESTRATION_WS_METHODS.listHighlights]: (input) =>
      dependencies.rpcEffect(dependencies.highlightsQuery.list(input), "Failed to load highlights"),
    [ORCHESTRATION_WS_METHODS.repairState]: () =>
      dependencies.rpcEffect(
        dependencies.orchestrationEngine.repairState(),
        "Failed to repair orchestration state",
      ),
    [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
      dependencies.rpcEffect(
        dependencies.checkpointDiffQuery.getTurnDiff(input),
        "Failed to load turn diff",
      ),
    [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
      dependencies.rpcEffect(
        dependencies.checkpointDiffQuery.getFullThreadDiff(input),
        "Failed to load full thread diff",
      ),
    [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
      dependencies.rpcEffect(
        Stream.runCollect(
          dependencies.orchestrationEngine.readEvents(
            clamp(input.fromSequenceExclusive, {
              maximum: Number.MAX_SAFE_INTEGER,
              minimum: 0,
            }),
          ),
        ).pipe(Effect.map((events) => Array.from(events))),
        "Failed to replay orchestration events",
      ),
    [ORCHESTRATION_WS_METHODS.subscribeShell]: () =>
      Stream.merge(
        Stream.fromEffect(
          dependencies.projectionReadModelQuery.getShellSnapshot().pipe(
            Effect.map((snapshot) => ({ kind: "snapshot" as const, snapshot })),
            Effect.mapError((cause) => toWsRpcError(cause, "Failed to load shell snapshot")),
          ),
        ),
        bufferLiveUiStream(
          dependencies.orchestrationEngine.streamDomainEvents.pipe(
            Stream.filter(isShellRelevantEvent),
          ),
          {
            label: "orchestration.shell",
            onDroppedEvents: failLiveUiStreamForSnapshotResync,
          },
        ).pipe(
          Stream.mapEffect(toShellStreamEvent),
          Stream.flatMap((event) =>
            Option.isSome(event) ? Stream.succeed(event.value) : Stream.empty,
          ),
        ),
      ),
    [ORCHESTRATION_WS_METHODS.unsubscribeShell]: () => Effect.void,
    [ORCHESTRATION_WS_METHODS.subscribeThread]: (input) =>
      Stream.merge(
        Stream.fromEffect(
          dependencies.projectionReadModelQuery.getThreadDetailSnapshotById(input.threadId).pipe(
            Effect.map((snapshot) =>
              Option.map(snapshot, (value) => ({ kind: "snapshot" as const, snapshot: value })),
            ),
            Effect.mapError((cause) => toWsRpcError(cause, "Failed to load thread snapshot")),
          ),
        ).pipe(
          Stream.flatMap((snapshot) =>
            Option.isSome(snapshot) ? Stream.succeed(snapshot.value) : Stream.empty,
          ),
        ),
        bufferLiveUiStream(
          dependencies.orchestrationEngine.streamDomainEvents.pipe(
            Stream.filter((event) => isThreadDetailEventFor(input.threadId, event)),
          ),
          {
            label: "orchestration.thread-detail",
            onDroppedEvents: failLiveUiStreamForSnapshotResync,
          },
        ).pipe(Stream.map((event): OrchestrationThreadStreamItem => ({ kind: "event", event }))),
      ),
    [ORCHESTRATION_WS_METHODS.unsubscribeThread]: () => Effect.void,
  } satisfies Partial<WsRpcHandlers>;
}
