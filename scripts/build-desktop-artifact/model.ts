import { Config, Data, Effect, Option, Path, Schema } from "effect";

import { parseBooleanEnvValue } from "../lib/env-bool.ts";

export const BuildPlatform = Schema.Literals(["mac", "linux", "win"]);
export const BuildArch = Schema.Literals(["arm64", "x64", "universal"]);

export const RepoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("../..", import.meta.url))),
);

export interface PlatformConfig {
  readonly cliFlag: "--mac" | "--linux" | "--win";
  readonly defaultTarget: string;
  readonly archChoices: ReadonlyArray<typeof BuildArch.Type>;
}

export const PLATFORM_CONFIG: Record<typeof BuildPlatform.Type, PlatformConfig> = {
  mac: {
    cliFlag: "--mac",
    defaultTarget: "dmg",
    archChoices: ["arm64", "x64", "universal"],
  },
  linux: {
    cliFlag: "--linux",
    defaultTarget: "AppImage",
    archChoices: ["x64", "arm64"],
  },
  win: {
    cliFlag: "--win",
    defaultTarget: "nsis",
    archChoices: ["x64", "arm64"],
  },
};

export interface BuildCliInput {
  readonly platform: Option.Option<typeof BuildPlatform.Type>;
  readonly target: Option.Option<string>;
  readonly arch: Option.Option<typeof BuildArch.Type>;
  readonly buildVersion: Option.Option<string>;
  readonly outputDir: Option.Option<string>;
  readonly skipBuild: Option.Option<boolean>;
  readonly keepStage: Option.Option<boolean>;
  readonly signed: Option.Option<boolean>;
  readonly verbose: Option.Option<boolean>;
  readonly mockUpdates: Option.Option<boolean>;
  readonly mockUpdateServerPort: Option.Option<string>;
}

export interface ResolvedBuildOptions {
  readonly platform: typeof BuildPlatform.Type;
  readonly target: string;
  readonly arch: typeof BuildArch.Type;
  readonly version: string | undefined;
  readonly outputDir: string;
  readonly skipBuild: boolean;
  readonly keepStage: boolean;
  readonly signed: boolean;
  readonly verbose: boolean;
  readonly mockUpdates: boolean;
  readonly mockUpdateServerPort: string | undefined;
}

export interface StagePackageJson {
  readonly name: string;
  readonly version: string;
  readonly buildVersion: string;
  readonly agentGroupCommitHash: string;
  readonly private: true;
  readonly license: "MIT";
  readonly description: string;
  readonly author: string;
  readonly main: string;
  readonly build: Record<string, unknown>;
  readonly dependencies: Record<string, unknown>;
  readonly devDependencies: {
    readonly electron: string;
  };
  readonly overrides: Record<string, unknown>;
}

export class BuildScriptError extends Data.TaggedError("BuildScriptError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function detectHostBuildPlatform(hostPlatform: string): typeof BuildPlatform.Type | undefined {
  if (hostPlatform === "darwin") return "mac";
  if (hostPlatform === "linux") return "linux";
  if (hostPlatform === "win32") return "win";
  return undefined;
}

function getDefaultArch(platform: typeof BuildPlatform.Type): typeof BuildArch.Type {
  const config = PLATFORM_CONFIG[platform];
  if (!config) {
    return "x64";
  }

  if (process.arch === "arm64" && config.archChoices.includes("arm64")) {
    return "arm64";
  }
  if (process.arch === "x64" && config.archChoices.includes("x64")) {
    return "x64";
  }

  return config.archChoices[0] ?? "x64";
}

const BuildEnvConfig = Config.all({
  platform: Config.schema(BuildPlatform, "AGENT_GROUP_DESKTOP_PLATFORM").pipe(Config.option),
  target: Config.string("AGENT_GROUP_DESKTOP_TARGET").pipe(Config.option),
  arch: Config.schema(BuildArch, "AGENT_GROUP_DESKTOP_ARCH").pipe(Config.option),
  version: Config.string("AGENT_GROUP_DESKTOP_VERSION").pipe(Config.option),
  outputDir: Config.string("AGENT_GROUP_DESKTOP_OUTPUT_DIR").pipe(Config.option),
  skipBuild: Config.string("AGENT_GROUP_DESKTOP_SKIP_BUILD").pipe(Config.option),
  keepStage: Config.string("AGENT_GROUP_DESKTOP_KEEP_STAGE").pipe(Config.option),
  signed: Config.string("AGENT_GROUP_DESKTOP_SIGNED").pipe(Config.option),
  verbose: Config.string("AGENT_GROUP_DESKTOP_VERBOSE").pipe(Config.option),
  mockUpdates: Config.string("AGENT_GROUP_DESKTOP_MOCK_UPDATES").pipe(Config.option),
  mockUpdateServerPort: Config.string("AGENT_GROUP_DESKTOP_MOCK_UPDATE_SERVER_PORT").pipe(Config.option),
});

const resolveBooleanFlag = (flag: Option.Option<boolean>, envValue: boolean) =>
  Option.getOrElse(flag, () => envValue);

const mergeOptions = <A>(a: Option.Option<A>, b: Option.Option<A>, defaultValue: A) =>
  Option.getOrElse(a, () => Option.getOrElse(b, () => defaultValue));

const resolveBooleanEnv = (name: string, value: Option.Option<string>) =>
  Effect.try({
    try: () =>
      Option.match(value, {
        onNone: () => false,
        onSome: (rawValue) => parseBooleanEnvValue(name, rawValue),
      }),
    catch: (cause) =>
      new BuildScriptError({
        message: cause instanceof Error ? cause.message : `Could not parse ${name}.`,
        cause,
      }),
  });

export const resolveBuildOptions = Effect.fn("resolveBuildOptions")(function* (
  input: BuildCliInput,
) {
  const path = yield* Path.Path;
  const repoRoot = yield* RepoRoot;
  const env = yield* BuildEnvConfig.asEffect();

  const platform = mergeOptions(
    input.platform,
    env.platform,
    detectHostBuildPlatform(process.platform),
  );

  if (!platform) {
    return yield* new BuildScriptError({
      message: `Unsupported host platform '${process.platform}'.`,
    });
  }

  const target = mergeOptions(input.target, env.target, PLATFORM_CONFIG[platform].defaultTarget);
  const arch = mergeOptions(input.arch, env.arch, getDefaultArch(platform));
  const version = mergeOptions(input.buildVersion, env.version, undefined);
  const envSkipBuild = yield* resolveBooleanEnv("AGENT_GROUP_DESKTOP_SKIP_BUILD", env.skipBuild);
  const envKeepStage = yield* resolveBooleanEnv("AGENT_GROUP_DESKTOP_KEEP_STAGE", env.keepStage);
  const envSigned = yield* resolveBooleanEnv("AGENT_GROUP_DESKTOP_SIGNED", env.signed);
  const envVerbose = yield* resolveBooleanEnv("AGENT_GROUP_DESKTOP_VERBOSE", env.verbose);
  const envMockUpdates = yield* resolveBooleanEnv("AGENT_GROUP_DESKTOP_MOCK_UPDATES", env.mockUpdates);
  const releaseDir = resolveBooleanFlag(input.mockUpdates, envMockUpdates)
    ? "release-mock"
    : "release";
  const outputDir = path.resolve(
    repoRoot,
    mergeOptions(input.outputDir, env.outputDir, releaseDir),
  );

  const skipBuild = resolveBooleanFlag(input.skipBuild, envSkipBuild);
  const keepStage = resolveBooleanFlag(input.keepStage, envKeepStage);
  const signed = resolveBooleanFlag(input.signed, envSigned);
  const verbose = resolveBooleanFlag(input.verbose, envVerbose);
  const mockUpdates = resolveBooleanFlag(input.mockUpdates, envMockUpdates);
  const mockUpdateServerPort = mergeOptions(
    input.mockUpdateServerPort,
    env.mockUpdateServerPort,
    undefined,
  );

  return {
    platform,
    target,
    arch,
    version,
    outputDir,
    skipBuild,
    keepStage,
    signed,
    verbose,
    mockUpdates,
    mockUpdateServerPort,
  } satisfies ResolvedBuildOptions;
});
