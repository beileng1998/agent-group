import type {
  ModelInfo,
  Options as ClaudeQueryOptions,
  PermissionMode,
  SDKUserMessage,
  SettingSource,
} from "@anthropic-ai/claude-agent-sdk";
import {
  ThreadId,
  type ProviderListCommandsInput,
  type ProviderListCommandsResult,
  type ProviderListModelsInput,
  type ProviderListModelsResult,
  type ProviderListAgentsResult,
} from "@agent-group/contracts";
import { Effect } from "effect";

import { type ClaudeQueryRuntime, type ClaudeSessionContext } from "./claudeAdapterRuntime.ts";
import { toMessage, toRequestError } from "./claudeAdapterErrors.ts";
import {
  mapSupportedCommands,
  mapSupportedModels,
  neverResolvingUserMessageStream,
} from "./claudeAdapterProtocol.ts";
import { ProviderAdapterProcessError } from "./Errors.ts";

const PROVIDER = "claudeAgent" as const;
const MODEL_CACHE_TTL_MS = 60_000;
const SETTING_SOURCES = [
  "user",
  "project",
  "local",
] as const satisfies ReadonlyArray<SettingSource>;

export type ClaudeQueryFactory = (input: {
  readonly prompt: AsyncIterable<SDKUserMessage>;
  readonly options: ClaudeQueryOptions;
}) => ClaudeQueryRuntime;

export function claudeModelDiscoveryKey(cwd: string, binaryPath: string): string {
  return `${binaryPath}\u0000${cwd}`;
}

export function makeClaudeCapabilityDiscovery(input: {
  readonly createQuery: ClaudeQueryFactory;
  readonly sessions: ReadonlyMap<ThreadId, ClaudeSessionContext>;
  readonly defaultCwd: string;
  readonly resolveSdkEnv: Effect.Effect<NodeJS.ProcessEnv>;
}) {
  const modelCache = new Map<
    string,
    { readonly result: ProviderListModelsResult; readonly cachedAt: number }
  >();
  const pendingModelDiscovery = new Map<string, Promise<ProviderListModelsResult>>();
  let agentsCache: ProviderListAgentsResult | null = null;
  let commandsCache: { result: ProviderListCommandsResult; cwd: string } | null = null;
  let pendingCommandDiscovery: Promise<ProviderListCommandsResult> | null = null;

  const cacheModels = (key: string, models: ModelInfo[]) => {
    const result = mapSupportedModels(models);
    modelCache.set(key, { result, cachedAt: Date.now() });
    return result;
  };

  const cacheAgents = (agents: Awaited<ReturnType<ClaudeQueryRuntime["supportedAgents"]>>) => {
    agentsCache = {
      agents: agents.map((agent) => ({
        name: agent.name,
        displayName: agent.name,
        ...(agent.description ? { description: agent.description } : {}),
        ...(agent.model ? { model: agent.model } : {}),
      })),
      source: "sdk",
      cached: false,
    };
  };

  const prefetchFromQuery = (modelDiscoveryKey: string, query: ClaudeQueryRuntime): void => {
    if (!modelCache.has(modelDiscoveryKey)) {
      query
        .supportedModels()
        .then((models) => cacheModels(modelDiscoveryKey, models))
        .catch(() => undefined);
    }

    if (!agentsCache) {
      query
        .supportedAgents()
        .then(cacheAgents)
        .catch(() => undefined);
    }
  };

  async function withTemporaryProcess<A>(
    processInput: {
      readonly cwd: string;
      readonly binaryPath: string;
      readonly env: NodeJS.ProcessEnv;
    },
    discover: (query: ClaudeQueryRuntime) => Promise<A>,
  ): Promise<A> {
    const query = input.createQuery({
      prompt: neverResolvingUserMessageStream(),
      options: {
        cwd: processInput.cwd,
        pathToClaudeCodeExecutable: processInput.binaryPath,
        settingSources: [...SETTING_SOURCES],
        permissionMode: "plan" as PermissionMode,
        persistSession: false,
        env: processInput.env,
      },
    });

    try {
      void (async () => {
        for await (const message of query) {
          void message;
        }
      })().catch(() => undefined);
      return await discover(query);
    } finally {
      query.close();
    }
  }

  const listCommands = (request: ProviderListCommandsInput) =>
    Effect.gen(function* () {
      const context = request.threadId
        ? input.sessions.get(ThreadId.makeUnsafe(request.threadId))
        : [...input.sessions.values()].find((session) => !session.stopped);

      if (context && !context.stopped) {
        const commands = yield* Effect.tryPromise({
          try: () => context.query.supportedCommands(),
          catch: (cause) => toRequestError(context.session.threadId, "listCommands", cause),
        });
        const result = mapSupportedCommands(commands);
        commandsCache = { result, cwd: request.cwd };
        return result;
      }

      if (commandsCache && commandsCache.cwd === request.cwd && !request.forceReload) {
        return { ...commandsCache.result, cached: true } satisfies ProviderListCommandsResult;
      }

      const env = yield* input.resolveSdkEnv;
      const discovery =
        pendingCommandDiscovery ??
        withTemporaryProcess({ cwd: request.cwd, binaryPath: "claude", env }, async (query) =>
          mapSupportedCommands(await query.supportedCommands()),
        );
      pendingCommandDiscovery = discovery;

      const result = yield* Effect.tryPromise({
        try: () => discovery,
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: ThreadId.makeUnsafe("discovery"),
            detail: toMessage(cause, "Failed to discover Claude commands."),
            cause,
          }),
      }).pipe(
        Effect.tap(() => Effect.sync(() => (pendingCommandDiscovery = null))),
        Effect.tapError(() => Effect.sync(() => (pendingCommandDiscovery = null))),
      );

      commandsCache = { result, cwd: request.cwd };
      return result;
    });

  const listModels = (request: ProviderListModelsInput) =>
    Effect.gen(function* () {
      const cwd = request.cwd?.trim() || input.defaultCwd;
      const binaryPath = request.binaryPath?.trim() || "claude";
      const key = claudeModelDiscoveryKey(cwd, binaryPath);
      const cached = modelCache.get(key);
      if (cached && Date.now() - cached.cachedAt < MODEL_CACHE_TTL_MS) {
        return { ...cached.result, cached: true } satisfies ProviderListModelsResult;
      }

      const activeContext = [...input.sessions.values()].find(
        (context) => !context.stopped && context.modelDiscoveryKey === key,
      );
      if (activeContext) {
        const models = yield* Effect.tryPromise({
          try: () => activeContext.query.supportedModels(),
          catch: (cause) => toRequestError(activeContext.session.threadId, "listModels", cause),
        });
        return cacheModels(key, models);
      }

      let discovery = pendingModelDiscovery.get(key);
      if (!discovery) {
        const env = yield* input.resolveSdkEnv;
        discovery = withTemporaryProcess({ cwd, binaryPath, env }, async (query) =>
          mapSupportedModels(await query.supportedModels()),
        ).finally(() => pendingModelDiscovery.delete(key));
        pendingModelDiscovery.set(key, discovery);
      }

      const result = yield* Effect.tryPromise({
        try: () => discovery,
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: ThreadId.makeUnsafe("discovery"),
            detail: toMessage(cause, "Failed to discover Claude models."),
            cause,
          }),
      });
      modelCache.set(key, { result, cachedAt: Date.now() });
      return result;
    });

  const listAgents = () =>
    Effect.sync(() => {
      if (agentsCache) {
        return { ...agentsCache, cached: true };
      }
      for (const context of input.sessions.values()) {
        if (!context.stopped) {
          context.query
            .supportedAgents()
            .then(cacheAgents)
            .catch(() => undefined);
          break;
        }
      }
      return { agents: [], source: "pending", cached: false } satisfies ProviderListAgentsResult;
    });

  return {
    listAgents,
    listCommands,
    listModels,
    prefetchFromQuery,
  };
}
