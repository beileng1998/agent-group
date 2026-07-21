import { homedir } from "node:os";
import { delimiter as pathDelimiter, join as pathJoin } from "node:path";

import { Config, Data, Effect, Hash, Option, Path } from "effect";

export const BASE_SERVER_PORT = 3773;
export const BASE_WEB_PORT = 5733;
export const MAX_HASH_OFFSET = 3000;
export const MAX_PORT = 65535;

export const DEFAULT_AGENT_GROUP_HOME = Effect.map(Effect.service(Path.Path), (path) =>
  path.resolve(import.meta.dirname, "../..", ".agent-group"),
);

export const MODE_ARGS = {
  dev: [
    "run",
    "dev",
    "--ui=tui",
    "--filter=@agent-group/contracts",
    "--filter=@agent-group/web",
    "--filter=@agent-group/server",
    "--parallel",
  ],
  "dev:server": ["run", "dev", "--filter=@agent-group/server"],
  "dev:web": ["run", "dev", "--filter=@agent-group/web"],
  "dev:desktop": [
    "run",
    "dev",
    "--filter=@agent-group/desktop",
    "--filter=@agent-group/web",
    "--parallel",
  ],
} as const satisfies Record<string, ReadonlyArray<string>>;

export type DevMode = keyof typeof MODE_ARGS;

export const DEV_RUNNER_MODES = Object.keys(MODE_ARGS) as Array<DevMode>;

export class DevRunnerError extends Data.TaggedError("DevRunnerError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const optionalStringConfig = (name: string): Config.Config<string | undefined> =>
  Config.string(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );

export const optionalBooleanConfig = (name: string): Config.Config<boolean | undefined> =>
  Config.boolean(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );

export const optionalPortConfig = (name: string): Config.Config<number | undefined> =>
  Config.port(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );

export const optionalIntegerConfig = (name: string): Config.Config<number | undefined> =>
  Config.int(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );

export const optionalUrlConfig = (name: string): Config.Config<URL | undefined> =>
  Config.url(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );

export const OffsetConfig = Config.all({
  portOffset: optionalIntegerConfig("AGENT_GROUP_PORT_OFFSET"),
  devInstance: optionalStringConfig("AGENT_GROUP_DEV_INSTANCE"),
});

export const HomeConfig = optionalStringConfig("AGENT_GROUP_DEV_HOME");

export function resolveOffset(config: {
  readonly portOffset: number | undefined;
  readonly devInstance: string | undefined;
}): { readonly offset: number; readonly source: string } {
  if (config.portOffset !== undefined) {
    if (config.portOffset < 0) {
      throw new Error(`Invalid AGENT_GROUP_PORT_OFFSET: ${config.portOffset}`);
    }
    return {
      offset: config.portOffset,
      source: `AGENT_GROUP_PORT_OFFSET=${config.portOffset}`,
    };
  }

  const seed = config.devInstance?.trim();
  if (!seed) {
    return { offset: 0, source: "default ports" };
  }

  if (/^\d+$/.test(seed)) {
    return { offset: Number(seed), source: `numeric AGENT_GROUP_DEV_INSTANCE=${seed}` };
  }

  const offset = ((Hash.string(seed) >>> 0) % MAX_HASH_OFFSET) + 1;
  return { offset, source: `hashed AGENT_GROUP_DEV_INSTANCE=${seed}` };
}

function resolveBaseDir(baseDir: string | undefined): Effect.Effect<string, never, Path.Path> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const configured = baseDir?.trim();

    if (configured) {
      return path.resolve(configured);
    }

    return yield* DEFAULT_AGENT_GROUP_HOME;
  });
}

export interface CreateDevRunnerEnvInput {
  readonly mode: DevMode;
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly serverOffset: number;
  readonly webOffset: number;
  readonly agentGroupHome: string | undefined;
  readonly authToken: string | undefined;
  readonly noBrowser: boolean | undefined;
  readonly autoBootstrapProjectFromCwd: boolean | undefined;
  readonly logWebSocketEvents: boolean | undefined;
  readonly host: string | undefined;
  readonly port: number | undefined;
  readonly devUrl: URL | undefined;
}

export function createDevRunnerEnv({
  mode,
  baseEnv,
  serverOffset,
  webOffset,
  agentGroupHome,
  authToken,
  noBrowser,
  autoBootstrapProjectFromCwd,
  logWebSocketEvents,
  host,
  port,
  devUrl,
}: CreateDevRunnerEnvInput): Effect.Effect<NodeJS.ProcessEnv, never, Path.Path> {
  return Effect.gen(function* () {
    const serverPort = port ?? BASE_SERVER_PORT + serverOffset;
    const webPort = BASE_WEB_PORT + webOffset;
    const resolvedBaseDir = yield* resolveBaseDir(agentGroupHome);

    const output: NodeJS.ProcessEnv = {
      ...baseEnv,
      AGENT_GROUP_PORT: String(serverPort),
      PORT: String(webPort),
      ELECTRON_RENDERER_PORT: String(webPort),
      // The web backend binds IPv4 loopback by default. Keep both Vite's HTTP
      // proxy and the browser WebSocket on that same reachable endpoint.
      VITE_WS_URL: `ws://127.0.0.1:${serverPort}`,
      VITE_DEV_SERVER_URL: devUrl?.toString() ?? `http://localhost:${webPort}`,
      AGENT_GROUP_HOME: resolvedBaseDir,
    };

    const pathKey = process.platform === "win32" ? "Path" : "PATH";
    const existingPath = output[pathKey] ?? output.PATH ?? "";
    const localBin = pathJoin(homedir(), ".local", "bin");
    if (localBin.length > 0 && !existingPath.split(pathDelimiter).includes(localBin)) {
      const augmentedPath =
        existingPath.length > 0 ? `${localBin}${pathDelimiter}${existingPath}` : localBin;
      output[pathKey] = augmentedPath;
      if (pathKey === "Path") {
        output.PATH = augmentedPath;
      }
    }

    if (host !== undefined) {
      output.AGENT_GROUP_HOST = host;
    } else {
      delete output.AGENT_GROUP_HOST;
    }

    if (authToken !== undefined) {
      output.AGENT_GROUP_AUTH_TOKEN = authToken;
    } else {
      delete output.AGENT_GROUP_AUTH_TOKEN;
    }

    if (noBrowser !== undefined) {
      output.AGENT_GROUP_NO_BROWSER = noBrowser ? "1" : "0";
    } else {
      delete output.AGENT_GROUP_NO_BROWSER;
    }

    if (autoBootstrapProjectFromCwd !== undefined) {
      output.AGENT_GROUP_AUTO_BOOTSTRAP_PROJECT_FROM_CWD = autoBootstrapProjectFromCwd ? "1" : "0";
    } else {
      delete output.AGENT_GROUP_AUTO_BOOTSTRAP_PROJECT_FROM_CWD;
    }

    if (logWebSocketEvents !== undefined) {
      output.AGENT_GROUP_LOG_WS_EVENTS = logWebSocketEvents ? "1" : "0";
    } else {
      delete output.AGENT_GROUP_LOG_WS_EVENTS;
    }

    if (mode === "dev") {
      output.AGENT_GROUP_MODE = "web";
      delete output.AGENT_GROUP_DESKTOP_WS_URL;
    }

    if (mode === "dev:server" || mode === "dev:web") {
      output.AGENT_GROUP_MODE = "web";
      delete output.AGENT_GROUP_DESKTOP_WS_URL;
    }

    return output;
  });
}

export const readOptionalBooleanEnv = (name: string): boolean | undefined => {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  if (value === "1" || value.toLowerCase() === "true") {
    return true;
  }
  if (value === "0" || value.toLowerCase() === "false") {
    return false;
  }
  return undefined;
};

export const resolveOptionalBooleanOverride = (
  explicitValue: boolean | undefined,
  envValue: boolean | undefined,
): boolean | undefined => {
  if (explicitValue === true) {
    return true;
  }

  if (explicitValue === false) {
    return envValue;
  }

  return envValue;
};
