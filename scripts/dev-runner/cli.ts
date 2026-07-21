import * as NodeServices from "@effect/platform-node/NodeServices";
import { NetService } from "@agent-group/shared/Net";
import { Effect, Layer, Logger, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import {
  DEV_RUNNER_MODES,
  HomeConfig,
  optionalBooleanConfig,
  optionalPortConfig,
  optionalStringConfig,
  optionalUrlConfig,
} from "./config.ts";
import { runDevRunnerWithInput } from "./run.ts";

const devRunnerCli = Command.make("dev-runner", {
  mode: Argument.choice("mode", DEV_RUNNER_MODES).pipe(
    Argument.withDescription("Development mode to run."),
  ),
  agentGroupHome: Flag.string("home-dir").pipe(
    Flag.withDescription("Development data directory (or use AGENT_GROUP_DEV_HOME)."),
    Flag.withFallbackConfig(HomeConfig),
  ),
  authToken: Flag.string("auth-token").pipe(
    Flag.withDescription("Development auth token (or use AGENT_GROUP_DEV_AUTH_TOKEN)."),
    Flag.withAlias("token"),
    Flag.withFallbackConfig(optionalStringConfig("AGENT_GROUP_DEV_AUTH_TOKEN")),
  ),
  noBrowser: Flag.boolean("no-browser").pipe(
    Flag.withDescription("Disable browser auto-open (or use AGENT_GROUP_DEV_NO_BROWSER)."),
    Flag.withFallbackConfig(optionalBooleanConfig("AGENT_GROUP_DEV_NO_BROWSER")),
  ),
  autoBootstrapProjectFromCwd: Flag.boolean("auto-bootstrap-project-from-cwd").pipe(
    Flag.withDescription(
      "Auto-bootstrap the current project (or use AGENT_GROUP_DEV_AUTO_BOOTSTRAP_PROJECT_FROM_CWD).",
    ),
    Flag.withFallbackConfig(
      optionalBooleanConfig("AGENT_GROUP_DEV_AUTO_BOOTSTRAP_PROJECT_FROM_CWD"),
    ),
  ),
  logWebSocketEvents: Flag.boolean("log-websocket-events").pipe(
    Flag.withDescription("WebSocket event logging toggle (or use AGENT_GROUP_DEV_LOG_WS_EVENTS)."),
    Flag.withAlias("log-ws-events"),
    Flag.withFallbackConfig(optionalBooleanConfig("AGENT_GROUP_DEV_LOG_WS_EVENTS")),
  ),
  host: Flag.string("host").pipe(
    Flag.withDescription("Development server host (or use AGENT_GROUP_DEV_HOST)."),
    Flag.withFallbackConfig(optionalStringConfig("AGENT_GROUP_DEV_HOST")),
  ),
  port: Flag.integer("port").pipe(
    Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
    Flag.withDescription("Development server port (or use AGENT_GROUP_DEV_PORT)."),
    Flag.withFallbackConfig(optionalPortConfig("AGENT_GROUP_DEV_PORT")),
  ),
  devUrl: Flag.string("dev-url").pipe(
    Flag.withSchema(Schema.URLFromString),
    Flag.withDescription("Web development URL override (or use AGENT_GROUP_DEV_URL)."),
    Flag.withFallbackConfig(optionalUrlConfig("AGENT_GROUP_DEV_URL")),
  ),
  dryRun: Flag.boolean("dry-run").pipe(
    Flag.withDescription("Resolve mode/ports/env and print, but do not spawn turbo."),
    Flag.withDefault(false),
  ),
  turboArgs: Argument.string("turbo-arg").pipe(
    Argument.withDescription("Additional turbo args (pass after `--`)."),
    Argument.variadic(),
  ),
}).pipe(
  Command.withDescription("Run monorepo development modes with deterministic port/env wiring."),
  Command.withHandler((input) => runDevRunnerWithInput(input)),
);

const cliRuntimeLayer = Layer.mergeAll(
  Logger.layer([Logger.consolePretty()]),
  NodeServices.layer,
  NetService.layer,
);

export const runtimeProgram = Command.run(devRunnerCli, { version: "0.0.0" }).pipe(
  Effect.scoped,
  Effect.provide(cliRuntimeLayer),
);
