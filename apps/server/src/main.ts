/**
 * CliConfig - CLI/runtime bootstrap service definitions.
 *
 * Defines startup-only service contracts used while resolving process config
 * and constructing server runtime layers.
 *
 * @module CliConfig
 */
import OS from "node:os";
import { Config, Data, Effect, FileSystem, Layer, Option, Path, Schema, ServiceMap } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { NetService } from "@agent-group/shared/Net";
import {
  DEFAULT_PORT,
  deriveServerPaths,
  resolveCanonicalWorkspaceRoots,
  resolveStaticDir,
  ServerConfig,
  type RuntimeMode,
  type ServerConfigShape,
} from "./config";
import { fixPath, resolveBaseDir } from "./os-jank";
import { Open } from "./open";
import * as SqlitePersistence from "./persistence/Layers/Sqlite";
import { makeServerProviderLayer, makeServerRuntimeServicesLayer } from "./serverLayers";
import { startServerMemoryDiagnostics } from "./memoryDiagnostics";
import { startClaudeCredentialKeepalive } from "./provider/claudeCredentialKeepalive";
import { ProviderHealthLive } from "./provider/Layers/ProviderHealth";
import { ProviderSessionReaperLive } from "./provider/Layers/ProviderSessionReaper";
import { Server } from "./effectServer";
import { ServerLoggerLive } from "./serverLogger";
import { ServerSettingsService } from "./serverSettings";
import { formatHostForUrl, isLoopbackHost, isWildcardHost } from "./startupAccess";

export class StartupError extends Data.TaggedError("StartupError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface CliInput {
  readonly mode: Option.Option<RuntimeMode>;
  readonly port: Option.Option<number>;
  readonly host: Option.Option<string>;
  readonly agentGroupHome: Option.Option<string>;
  readonly devUrl: Option.Option<URL>;
  readonly noBrowser: Option.Option<boolean>;
  readonly authToken: Option.Option<string>;
  readonly autoBootstrapProjectFromCwd: Option.Option<boolean>;
  readonly logProviderEvents: Option.Option<boolean>;
  readonly logWebSocketEvents: Option.Option<boolean>;
}

/**
 * CliConfigShape - Startup helpers required while building server layers.
 */
export interface CliConfigShape {
  /**
   * Current process working directory.
   */
  readonly cwd: string;

  /**
   * Apply OS-specific PATH normalization.
   */
  readonly fixPath: Effect.Effect<void>;

  /**
   * Resolve static web asset directory for server mode.
   */
  readonly resolveStaticDir: Effect.Effect<string | undefined>;
}

/**
 * CliConfig - Service tag for startup CLI/runtime helpers.
 */
export class CliConfig extends ServiceMap.Service<CliConfig, CliConfigShape>()(
  "agent-group/main/CliConfig",
) {
  static readonly layer = Layer.effect(
    CliConfig,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      return {
        cwd: process.cwd(),
        fixPath: Effect.sync(fixPath),
        resolveStaticDir: resolveStaticDir().pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      } satisfies CliConfigShape;
    }),
  );
}

const CliEnvConfig = Config.all({
  mode: Config.string("AGENT_GROUP_MODE").pipe(
    Config.option,
    Config.map(
      Option.match<RuntimeMode, string>({
        onNone: () => "web",
        onSome: (value) => (value === "desktop" ? "desktop" : "web"),
      }),
    ),
  ),
  port: Config.port("AGENT_GROUP_PORT").pipe(Config.option, Config.map(Option.getOrUndefined)),
  host: Config.string("AGENT_GROUP_HOST").pipe(Config.option, Config.map(Option.getOrUndefined)),
  agentGroupHome: Config.string("AGENT_GROUP_HOME").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  devUrl: Config.url("VITE_DEV_SERVER_URL").pipe(Config.option, Config.map(Option.getOrUndefined)),
  noBrowser: Config.boolean("AGENT_GROUP_NO_BROWSER").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  authToken: Config.string("AGENT_GROUP_AUTH_TOKEN").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  tailnetSidecarPath: Config.string("AGENT_GROUP_TAILNET_SIDECAR_PATH").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  tailnetProxyUrl: Config.string("AGENT_GROUP_TAILNET_PROXY_URL").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  autoBootstrapProjectFromCwd: Config.boolean("AGENT_GROUP_AUTO_BOOTSTRAP_PROJECT_FROM_CWD").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  logProviderEvents: Config.boolean("AGENT_GROUP_LOG_PROVIDER_EVENTS").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  logWebSocketEvents: Config.boolean("AGENT_GROUP_LOG_WS_EVENTS").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
});

const resolveBooleanFlag = (flag: Option.Option<boolean>, envValue: boolean) =>
  Option.getOrElse(Option.filter(flag, Boolean), () => envValue);

const ServerConfigLive = (input: CliInput) =>
  Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      const cliConfig = yield* CliConfig;
      const { findAvailablePort } = yield* NetService;
      const env = yield* CliEnvConfig.asEffect().pipe(
        Effect.mapError(
          (cause) =>
            new StartupError({ message: "Failed to read environment configuration", cause }),
        ),
      );

      const mode = Option.getOrElse(input.mode, () => env.mode);

      const port = yield* Option.match(input.port, {
        onSome: (value) => Effect.succeed(value),
        onNone: () => {
          if (env.port) {
            return Effect.succeed(env.port);
          }
          if (mode === "desktop") {
            return Effect.succeed(DEFAULT_PORT);
          }
          return findAvailablePort(DEFAULT_PORT);
        },
      });

      const devUrl = Option.getOrElse(input.devUrl, () => env.devUrl);
      const configuredHome = Option.getOrUndefined(input.agentGroupHome) ?? env.agentGroupHome;
      const baseDir = yield* resolveBaseDir(configuredHome);
      const userHomeDir = OS.homedir();
      const derivedPaths = yield* deriveServerPaths(baseDir, devUrl);
      const noBrowser = resolveBooleanFlag(input.noBrowser, env.noBrowser ?? mode === "desktop");
      const authToken = Option.getOrUndefined(input.authToken) ?? env.authToken;
      const tailnetSidecarPath = env.tailnetSidecarPath;
      const tailnetProxyUrl = env.tailnetProxyUrl;
      const autoBootstrapProjectFromCwd = resolveBooleanFlag(
        input.autoBootstrapProjectFromCwd,
        env.autoBootstrapProjectFromCwd ?? mode === "web",
      );
      // Provider event NDJSON logging is helpful for debugging, but it is too
      // expensive to keep enabled on the streaming hot path by default.
      const logProviderEvents = resolveBooleanFlag(
        input.logProviderEvents,
        env.logProviderEvents ?? false,
      );
      // Keep websocket payload logging opt-in in dev. Terminal/TUI traffic is
      // high-volume enough that automatic logging adds noticeable CPU and I/O.
      const logWebSocketEvents = resolveBooleanFlag(
        input.logWebSocketEvents,
        env.logWebSocketEvents ?? false,
      );
      const staticDir = devUrl ? undefined : yield* cliConfig.resolveStaticDir;
      const host = Option.getOrUndefined(input.host) ?? env.host ?? "127.0.0.1";

      if (!isLoopbackHost(host) && !authToken) {
        return yield* new StartupError({
          message:
            "Remote-reachable hosts require --auth-token. Refusing to start without authentication.",
        });
      }

      const { homeDir, chatWorkspaceRoot, studioWorkspaceRoot } =
        yield* resolveCanonicalWorkspaceRoots({ homeDir: userHomeDir });

      const config: ServerConfigShape = {
        mode,
        port,
        cwd: cliConfig.cwd,
        homeDir,
        chatWorkspaceRoot,
        studioWorkspaceRoot,
        host,
        baseDir,
        ...derivedPaths,
        staticDir,
        devUrl,
        noBrowser,
        authToken,
        tailnetSidecarPath,
        tailnetProxyUrl,
        autoBootstrapProjectFromCwd,
        logProviderEvents,
        logWebSocketEvents,
      } satisfies ServerConfigShape;

      return config;
    }),
  );

const LayerLive = (input: CliInput) => {
  const runtimeServicesLayer = makeServerRuntimeServicesLayer();
  const providerLayer = makeServerProviderLayer();
  const providerHealthLayer = ProviderHealthLive.pipe(
    // Provider health reads persisted provider settings while constructing its
    // cache, so build it with the same runtime services layer exposed to Server.
    Layer.provideMerge(runtimeServicesLayer),
  );
  const providerSessionReaperLayer = ProviderSessionReaperLive.pipe(
    // The reaper coordinates orchestration state with live provider sessions,
    // so it belongs at the top level where both layers are available.
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(providerLayer),
  );

  return Layer.empty.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(providerLayer),
    Layer.provideMerge(providerHealthLayer),
    Layer.provideMerge(providerSessionReaperLayer),
    Layer.provideMerge(SqlitePersistence.layerConfig),
    Layer.provideMerge(ServerLoggerLive),
    Layer.provideMerge(ServerConfigLive(input)),
  );
};

const makeServerProgram = (input: CliInput) =>
  Effect.gen(function* () {
    const cliConfig = yield* CliConfig;
    const { start, stopSignal } = yield* Server;
    const openDeps = yield* Open;
    const serverSettings = yield* ServerSettingsService;
    yield* cliConfig.fixPath;

    const config = yield* ServerConfig;
    yield* Effect.sync(() => startServerMemoryDiagnostics({ mode: config.mode }));

    if (!config.devUrl && !config.staticDir) {
      yield* Effect.logWarning(
        "web bundle missing and no VITE_DEV_SERVER_URL; web UI unavailable",
        {
          hint: "Run `bun run --cwd apps/web build` or set VITE_DEV_SERVER_URL for dev mode.",
        },
      );
    }

    yield* start;

    // Optional Claude OAuth keepalive. Disabled by default because it touches
    // Claude Code auth data in the background; users can opt in with
    // AGENT_GROUP_CLAUDE_KEEPALIVE=1.
    yield* Effect.forkChild(
      Effect.gen(function* () {
        const settings = yield* serverSettings.getSettings;
        if (settings.providers.claudeAgent.enabled === false) {
          return;
        }
        yield* Effect.sync(() =>
          startClaudeCredentialKeepalive({
            binaryPath: settings.providers.claudeAgent.binaryPath,
            homeDir: config.homeDir,
            log: (message) => Effect.runFork(Effect.logInfo(message)),
          }),
        );
      }),
    );

    const localUrl = `http://localhost:${config.port}`;
    const bindUrl =
      config.host && !isWildcardHost(config.host)
        ? `http://${formatHostForUrl(config.host)}:${config.port}`
        : localUrl;
    const { authToken, devUrl, ...safeConfig } = config;
    yield* Effect.logInfo("Agent Group running", {
      ...safeConfig,
      devUrl: devUrl?.toString(),
      authEnabled: Boolean(authToken),
    });

    if (!config.noBrowser) {
      const target = config.devUrl?.toString() ?? bindUrl;
      yield* openDeps.openBrowser(target).pipe(
        Effect.catch(() =>
          Effect.logInfo("browser auto-open unavailable", {
            hint: `Open ${target} in your browser.`,
          }),
        ),
      );
    }

    return yield* stopSignal;
  }).pipe(Effect.provide(LayerLive(input)));

/**
 * These flags mirrors the environment variables and the config shape.
 */

const modeFlag = Flag.choice("mode", ["web", "desktop"]).pipe(
  Flag.withDescription("Runtime mode. `desktop` keeps loopback defaults unless overridden."),
  Flag.optional,
);
const portFlag = Flag.integer("port").pipe(
  Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
  Flag.withDescription("Port for the HTTP/WebSocket server."),
  Flag.optional,
);
const hostFlag = Flag.string("host").pipe(
  Flag.withDescription("Host/interface to bind (for example 127.0.0.1, 0.0.0.0, or a Tailnet IP)."),
  Flag.optional,
);
const agentGroupHomeFlag = Flag.string("home-dir").pipe(
  Flag.withDescription("Base directory for all Agent Group data (equivalent to AGENT_GROUP_HOME)."),
  Flag.optional,
);
const devUrlFlag = Flag.string("dev-url").pipe(
  Flag.withSchema(Schema.URLFromString),
  Flag.withDescription("Dev web URL to proxy/redirect to (equivalent to VITE_DEV_SERVER_URL)."),
  Flag.optional,
);
const noBrowserFlag = Flag.boolean("no-browser").pipe(
  Flag.withDescription("Disable automatic browser opening."),
  Flag.optional,
);
const authTokenFlag = Flag.string("auth-token").pipe(
  Flag.withDescription("Auth token required for WebSocket connections."),
  Flag.withAlias("token"),
  Flag.optional,
);
const autoBootstrapProjectFromCwdFlag = Flag.boolean("auto-bootstrap-project-from-cwd").pipe(
  Flag.withDescription(
    "Create a project for the current working directory on startup when missing.",
  ),
  Flag.optional,
);
const logProviderEventsFlag = Flag.boolean("log-provider-events").pipe(
  Flag.withDescription(
    "Emit native/canonical provider NDJSON logs for debugging (equivalent to AGENT_GROUP_LOG_PROVIDER_EVENTS).",
  ),
  Flag.optional,
);
const logWebSocketEventsFlag = Flag.boolean("log-websocket-events").pipe(
  Flag.withDescription(
    "Emit server-side logs for outbound WebSocket push traffic (equivalent to AGENT_GROUP_LOG_WS_EVENTS).",
  ),
  Flag.withAlias("log-ws-events"),
  Flag.optional,
);

export const agentGroupCli = Command.make("agent-group", {
  mode: modeFlag,
  port: portFlag,
  host: hostFlag,
  agentGroupHome: agentGroupHomeFlag,
  devUrl: devUrlFlag,
  noBrowser: noBrowserFlag,
  authToken: authTokenFlag,
  autoBootstrapProjectFromCwd: autoBootstrapProjectFromCwdFlag,
  logProviderEvents: logProviderEventsFlag,
  logWebSocketEvents: logWebSocketEventsFlag,
}).pipe(
  Command.withDescription("Run the Agent Group server."),
  Command.withHandler((input) => Effect.scoped(makeServerProgram(input))),
);
