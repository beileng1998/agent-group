import {
  type ProviderListCommandsResult,
  type ProviderListModelsResult,
  ThreadId,
} from "@agent-group/contracts";
import { Effect, Option, Semaphore } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";

import type { ServerConfigShape } from "../config.ts";
import { listFactoryPlugins, readFactoryPlugin } from "./FactoryPluginDiscovery.ts";
import { mapAcpToAdapterError } from "./acp/AcpAdapterSupport.ts";
import {
  discoverDroidAcpModels,
  makeDroidAcpRuntime,
  type DroidAcpRuntimeSettings,
} from "./acp/DroidAcpSupport.ts";
import type { DroidSessionContext } from "./droidAdapterSessionState.ts";
import { resolveDroidSessionCwd } from "./droidAdapterSessionState.ts";
import { ProviderAdapterRequestError, ProviderAdapterValidationError } from "./Errors.ts";
import type { DroidAdapterShape } from "./Services/DroidAdapter.ts";

const PROVIDER = "droid" as const;
const CACHE_MS = 5 * 60_000;
const DISCOVERY_TIMEOUT_MS = 30_000;
const CACHE_MAX_ENTRIES = 16;

function setCacheEntry<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

export function makeDroidDiscovery(input: {
  readonly droidSettings: DroidAcpRuntimeSettings;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly serverConfig: ServerConfigShape;
  readonly sessions: Map<ThreadId, DroidSessionContext>;
  readonly discoveryLock: Semaphore.Semaphore;
}): Required<
  Pick<DroidAdapterShape, "listModels" | "listCommands" | "listPlugins" | "readPlugin">
> {
  const modelCache = new Map<
    string,
    { readonly expiresAt: number; readonly result: ProviderListModelsResult }
  >();
  const commandCache = new Map<
    string,
    { readonly expiresAt: number; readonly result: ProviderListCommandsResult }
  >();
  const makeRuntime = (request: {
    readonly binaryPath?: string;
    readonly cwd: string;
    readonly clientName: string;
  }) =>
    makeDroidAcpRuntime({
      droidSettings: {
        ...(input.droidSettings.binaryPath ? { binaryPath: input.droidSettings.binaryPath } : {}),
        ...(request.binaryPath ? { binaryPath: request.binaryPath } : {}),
      },
      childProcessSpawner: input.childProcessSpawner,
      cwd: request.cwd,
      clientInfo: { name: request.clientName, version: "0.0.0" },
    });
  const cacheKey = (binaryPath: string | undefined, cwd: string) =>
    `${binaryPath?.trim() || input.droidSettings.binaryPath?.trim() || "droid"}\u0000${cwd}`;

  const listModels: NonNullable<DroidAdapterShape["listModels"]> = (request) =>
    input.discoveryLock.withPermits(1)(
      Effect.gen(function* () {
        const cwd = resolveDroidSessionCwd(request.cwd, input.serverConfig);
        if (!cwd) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "listModels",
            issue: "cwd is required and no server cwd fallback is available.",
          });
        }
        const key = cacheKey(request.binaryPath, cwd);
        const cached = modelCache.get(key);
        if (cached && cached.expiresAt > Date.now()) return { ...cached.result, cached: true };
        const runtime = yield* makeRuntime({
          ...(request.binaryPath ? { binaryPath: request.binaryPath } : {}),
          cwd,
          clientName: "Agent Group Model Discovery",
        });
        yield* runtime.start();
        const result = yield* discoverDroidAcpModels(runtime);
        const commands = yield* runtime.getAvailableCommands;
        setCacheEntry(commandCache, key, {
          expiresAt: Date.now() + CACHE_MS,
          result: {
            commands: commands.map((command) => ({
              name: command.name,
              ...(command.description ? { description: command.description } : {}),
            })),
            source: "droid-acp",
            cached: false,
          },
        });
        setCacheEntry(modelCache, key, { expiresAt: Date.now() + CACHE_MS, result });
        return result;
      }).pipe(
        Effect.scoped,
        Effect.mapError((cause) =>
          cause instanceof ProviderAdapterValidationError
            ? cause
            : mapAcpToAdapterError(
                PROVIDER,
                ThreadId.makeUnsafe("droid-model-discovery"),
                "model/list",
                cause,
              ),
        ),
        Effect.timeoutOption(DISCOVERY_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "model/list",
                  detail: "Timed out while discovering Droid models over ACP.",
                }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      ),
    );

  const listPlugins: NonNullable<DroidAdapterShape["listPlugins"]> = (request) => {
    const sessionCwd = request.threadId
      ? input.sessions.get(ThreadId.makeUnsafe(request.threadId))?.session.cwd
      : undefined;
    const cwd = resolveDroidSessionCwd(request.cwd, input.serverConfig, sessionCwd);
    return Effect.tryPromise({
      try: () => listFactoryPlugins(input.serverConfig.homeDir, cwd),
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "plugin/list",
          detail: cause instanceof Error ? cause.message : "Failed to read Factory plugins.",
          cause,
        }),
    });
  };
  const readPlugin: NonNullable<DroidAdapterShape["readPlugin"]> = (request) => {
    const sessionCwd = request.threadId
      ? input.sessions.get(ThreadId.makeUnsafe(request.threadId))?.session.cwd
      : undefined;
    const cwd = resolveDroidSessionCwd(request.cwd, input.serverConfig, sessionCwd);
    return Effect.tryPromise({
      try: () =>
        readFactoryPlugin({
          homeDir: input.serverConfig.homeDir,
          marketplacePath: request.marketplacePath,
          pluginName: request.pluginName,
          ...(cwd !== undefined ? { cwd } : {}),
        }),
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "plugin/read",
          detail: cause instanceof Error ? cause.message : "Failed to read the Factory plugin.",
          cause,
        }),
    }).pipe(
      Effect.flatMap((result) =>
        result
          ? Effect.succeed(result)
          : Effect.fail(
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "plugin/read",
                detail: `Factory plugin '${request.pluginName}' was not found.`,
              }),
            ),
      ),
    );
  };

  const listCommands: NonNullable<DroidAdapterShape["listCommands"]> = (request) =>
    input.discoveryLock.withPermits(1)(
      Effect.gen(function* () {
        const cwd = resolveDroidSessionCwd(request.cwd, input.serverConfig);
        if (!cwd) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "listCommands",
            issue: "cwd is required and no server cwd fallback is available.",
          });
        }
        const key = cacheKey(request.binaryPath, cwd);
        const cached = commandCache.get(key);
        if (request.forceReload !== true && cached && cached.expiresAt > Date.now()) {
          return { ...cached.result, cached: true };
        }
        const runtime = yield* makeRuntime({
          ...(request.binaryPath ? { binaryPath: request.binaryPath } : {}),
          cwd,
          clientName: "Agent Group Command Discovery",
        });
        yield* runtime.start();
        let commands = yield* runtime.getAvailableCommands;
        const startedAt = Date.now();
        while (commands.length === 0 && Date.now() - startedAt < 500) {
          yield* Effect.sleep(25);
          commands = yield* runtime.getAvailableCommands;
        }
        const result = {
          commands: commands.map((command) => ({
            name: command.name,
            ...(command.description ? { description: command.description } : {}),
          })),
          source: "droid-acp",
          cached: false,
        } satisfies ProviderListCommandsResult;
        setCacheEntry(commandCache, key, { expiresAt: Date.now() + CACHE_MS, result });
        return result;
      }).pipe(
        Effect.scoped,
        Effect.mapError((cause) =>
          cause instanceof ProviderAdapterValidationError
            ? cause
            : mapAcpToAdapterError(
                PROVIDER,
                ThreadId.makeUnsafe("droid-command-discovery"),
                "command/list",
                cause,
              ),
        ),
        Effect.timeoutOption(DISCOVERY_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "command/list",
                  detail: "Timed out while discovering Droid commands over ACP.",
                }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      ),
    );
  return { listModels, listCommands, listPlugins, readPlugin };
}
