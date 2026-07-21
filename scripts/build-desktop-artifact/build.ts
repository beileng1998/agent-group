import desktopPackageJson from "../../apps/desktop/package.json" with { type: "json" };
import serverPackageJson from "../../apps/server/package.json" with { type: "json" };
import rootPackageJson from "../../package.json" with { type: "json" };

import { Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcess } from "effect/unstable/process";

import { DESKTOP_STAGE_DEPENDENCY_OVERRIDES } from "../lib/desktop-stage-dependency-overrides.ts";
import { stageDistributionLicenses } from "../lib/distribution-licenses.ts";
import { finalizeMacUpdateZip } from "../lib/mac-update-zip-finalize.ts";
import { resolveCatalogDependencies } from "../lib/resolve-catalog.ts";
import { assertPlatformBuildResources, validateBundledClientAssets } from "./assets.ts";
import {
  createBuildConfig,
  resolveDesktopRuntimeDependencies,
  resolveGitHubPublishConfig,
} from "./buildConfig.ts";
import {
  BuildScriptError,
  PLATFORM_CONFIG,
  RepoRoot,
  type ResolvedBuildOptions,
  type StagePackageJson,
} from "./model.ts";
import {
  commandOutputOptions,
  resolveGitCommitHash,
  resolvePythonForNodeGyp,
  runCommand,
} from "./process.ts";
import { stageMacAppSnapHelper, stageTailnetSidecar, verifyStagedNodePty } from "./staging.ts";
import { validateDesktopNativeBuildHost } from "../lib/desktop-platform-build-config.ts";

const encodeJsonString = Schema.encodeEffect(Schema.UnknownFromJsonString);

export const buildDesktopArtifact = Effect.fn("buildDesktopArtifact")(function* (
  options: ResolvedBuildOptions,
) {
  const repoRoot = yield* RepoRoot;
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  const platformConfig = PLATFORM_CONFIG[options.platform];
  if (!platformConfig) {
    return yield* new BuildScriptError({
      message: `Unsupported platform '${options.platform}'.`,
    });
  }
  const nativeBuildHostIssue = validateDesktopNativeBuildHost({
    platform: options.platform,
    arch: options.arch,
    hostPlatform: process.platform,
    hostArch: process.arch,
  });
  if (nativeBuildHostIssue) {
    return yield* new BuildScriptError({
      message: nativeBuildHostIssue,
    });
  }

  const electronVersion = desktopPackageJson.dependencies.electron;

  const serverDependencies = serverPackageJson.dependencies;
  if (!serverDependencies || Object.keys(serverDependencies).length === 0) {
    return yield* new BuildScriptError({
      message: "Could not resolve production dependencies from apps/server/package.json.",
    });
  }

  const resolvedOverrides = yield* Effect.try({
    try: () =>
      resolveCatalogDependencies(
        rootPackageJson.overrides,
        rootPackageJson.workspaces.catalog,
        "apps/desktop",
      ),
    catch: (cause) =>
      new BuildScriptError({
        message: "Could not resolve overrides from package.json.",
        cause,
      }),
  });

  const resolvedServerDependencies = yield* Effect.try({
    try: () =>
      resolveCatalogDependencies(
        serverDependencies,
        rootPackageJson.workspaces.catalog,
        "apps/server",
      ),
    catch: (cause) =>
      new BuildScriptError({
        message: "Could not resolve production dependencies from apps/server/package.json.",
        cause,
      }),
  });
  const resolvedDesktopRuntimeDependencies = yield* Effect.try({
    try: () =>
      resolveDesktopRuntimeDependencies(
        desktopPackageJson.dependencies,
        rootPackageJson.workspaces.catalog,
      ),
    catch: (cause) =>
      new BuildScriptError({
        message: "Could not resolve desktop runtime dependencies from apps/desktop/package.json.",
        cause,
      }),
  });

  const appVersion = options.version ?? serverPackageJson.version;
  const commitHash = resolveGitCommitHash(repoRoot);
  const mkdir = options.keepStage ? fs.makeTempDirectory : fs.makeTempDirectoryScoped;
  const stageRoot = yield* mkdir({
    prefix: `agent-group-desktop-${options.platform}-stage-`,
  });

  const stageAppDir = path.join(stageRoot, "app");
  const stageResourcesDir = path.join(stageAppDir, "apps/desktop/resources");
  const distDirs = {
    desktopDist: path.join(repoRoot, "apps/desktop/dist-electron"),
    desktopResources: path.join(repoRoot, "apps/desktop/resources"),
    serverDist: path.join(repoRoot, "apps/server/dist"),
  };
  const bundledClientEntry = path.join(distDirs.serverDist, "client/index.html");

  if (!options.skipBuild) {
    yield* Effect.log("[desktop-artifact] Building desktop/server/web artifacts...");
    yield* runCommand(
      ChildProcess.make({
        cwd: repoRoot,
        ...commandOutputOptions(options.verbose),
        // Windows needs shell mode to resolve .cmd shims (e.g. bun.cmd).
        shell: process.platform === "win32",
      })`bun run build:desktop`,
    );
  }

  for (const [label, dir] of Object.entries(distDirs)) {
    if (!(yield* fs.exists(dir))) {
      return yield* new BuildScriptError({
        message: `Missing ${label} at ${dir}. Run 'bun run build:desktop' first.`,
      });
    }
  }

  if (!(yield* fs.exists(bundledClientEntry))) {
    return yield* new BuildScriptError({
      message: `Missing bundled server client at ${bundledClientEntry}. Run 'bun run build:desktop' first.`,
    });
  }

  yield* validateBundledClientAssets(path.dirname(bundledClientEntry));

  yield* fs.makeDirectory(path.join(stageAppDir, "apps/desktop"), { recursive: true });
  yield* fs.makeDirectory(path.join(stageAppDir, "apps/server"), { recursive: true });

  yield* Effect.log("[desktop-artifact] Staging release app...");
  yield* fs.copy(distDirs.desktopDist, path.join(stageAppDir, "apps/desktop/dist-electron"));
  yield* fs.copy(distDirs.desktopResources, stageResourcesDir);
  yield* fs.copy(distDirs.serverDist, path.join(stageAppDir, "apps/server/dist"));
  yield* stageTailnetSidecar(stageAppDir, options.platform, options.arch, options.verbose);

  const licenseResult = yield* Effect.try({
    try: () =>
      stageDistributionLicenses({
        repoRoot,
        destinationDirectory: path.join(stageResourcesDir, "legal"),
      }),
    catch: (cause) =>
      new BuildScriptError({
        message: "Could not collect distribution license notices.",
        cause,
      }),
  });
  yield* Effect.log(
    `[desktop-artifact] Staged licenses for ${licenseResult.packageCount} production packages.`,
  );
  yield* fs.copyFile(
    path.join(repoRoot, "apps/tailnet/LICENSE"),
    path.join(stageResourcesDir, "legal", "TAILSCALE-BSD-3-CLAUSE.txt"),
  );
  if (licenseResult.packagesWithoutLicenseFiles.length > 0) {
    yield* Effect.logWarning("Some packages did not publish standalone license files.", {
      packages: licenseResult.packagesWithoutLicenseFiles,
    });
  }

  yield* assertPlatformBuildResources(options.platform, stageResourcesDir, options.verbose);

  if (options.platform === "mac") {
    yield* stageMacAppSnapHelper(stageAppDir, options.arch, options.verbose);
  }

  // electron-builder is filtering out stageResourcesDir directory in the AppImage for production
  yield* fs.copy(stageResourcesDir, path.join(stageAppDir, "apps/desktop/prod-resources"));

  const stagePackageJson: StagePackageJson = {
    name: "agent-group-desktop",
    version: appVersion,
    buildVersion: appVersion,
    agentGroupCommitHash: commitHash,
    private: true,
    license: "MIT",
    description: "Agent Group desktop build",
    author: "Agent Group contributors",
    main: "apps/desktop/dist-electron/main.js",
    build: yield* createBuildConfig(
      options.platform,
      options.target,
      desktopPackageJson.productName ?? "Agent Group",
      options.signed,
      options.mockUpdates,
      options.mockUpdateServerPort,
    ),
    dependencies: {
      ...resolvedServerDependencies,
      ...resolvedDesktopRuntimeDependencies,
    },
    devDependencies: {
      electron: electronVersion,
    },
    overrides: {
      ...DESKTOP_STAGE_DEPENDENCY_OVERRIDES,
      ...resolvedOverrides,
    },
  };

  const stagePackageJsonString = yield* encodeJsonString(stagePackageJson);
  yield* fs.writeFileString(path.join(stageAppDir, "package.json"), `${stagePackageJsonString}\n`);

  yield* Effect.log("[desktop-artifact] Installing staged production dependencies...");
  yield* runCommand(
    ChildProcess.make({
      cwd: stageAppDir,
      ...commandOutputOptions(options.verbose),
      // Windows needs shell mode to resolve .cmd shims (e.g. bun.cmd).
      shell: process.platform === "win32",
    })`bun install --production`,
  );

  if (options.platform === "linux") {
    yield* verifyStagedNodePty(stageAppDir, options.verbose);
  }

  const buildEnv: NodeJS.ProcessEnv = {
    ...process.env,
  };
  for (const [key, value] of Object.entries(buildEnv)) {
    if (value === "") {
      delete buildEnv[key];
    }
  }
  if (!options.signed) {
    buildEnv.CSC_IDENTITY_AUTO_DISCOVERY = "false";
    delete buildEnv.CSC_LINK;
    delete buildEnv.CSC_KEY_PASSWORD;
    delete buildEnv.APPLE_API_KEY;
    delete buildEnv.APPLE_API_KEY_ID;
    delete buildEnv.APPLE_API_ISSUER;
  }

  if (process.platform === "win32") {
    const python = resolvePythonForNodeGyp();
    if (python) {
      buildEnv.PYTHON = python;
      buildEnv.npm_config_python = python;
    }
    buildEnv.npm_config_msvs_version = buildEnv.npm_config_msvs_version ?? "2022";
    buildEnv.GYP_MSVS_VERSION = buildEnv.GYP_MSVS_VERSION ?? "2022";
  }

  yield* Effect.log(
    `[desktop-artifact] Building ${options.platform}/${options.target} (arch=${options.arch}, version=${appVersion})...`,
  );
  yield* runCommand(
    ChildProcess.make({
      cwd: stageAppDir,
      env: buildEnv,
      ...commandOutputOptions(options.verbose),
      // Windows needs shell mode to resolve .cmd shims.
      shell: process.platform === "win32",
    })`bunx electron-builder ${platformConfig.cliFlag} --${options.arch} --publish never`,
  );

  const stageDistDir = path.join(stageAppDir, "dist");
  if (!(yield* fs.exists(stageDistDir))) {
    return yield* new BuildScriptError({
      message: `Build completed but dist directory was not found at ${stageDistDir}`,
    });
  }

  if (options.platform === "mac") {
    yield* Effect.log("[desktop-artifact] Repacking and validating macOS update zip...");
    const finalizedZip = yield* Effect.tryPromise({
      try: () =>
        finalizeMacUpdateZip({
          stageDistDir,
          requireManifest: resolveGitHubPublishConfig() !== undefined || options.mockUpdates,
          verbose: options.verbose,
        }),
      catch: (cause) =>
        new BuildScriptError({
          message: "macOS update zip finalization failed.",
          cause,
        }),
    });
    if (finalizedZip.removedZipBlockmapPath) {
      yield* Effect.log(
        `[desktop-artifact] Removed stale macOS zip blockmap (${path.basename(finalizedZip.removedZipBlockmapPath)}).`,
      );
    }
  }

  const stageEntries = yield* fs.readDirectory(stageDistDir);
  yield* fs.makeDirectory(options.outputDir, { recursive: true });

  const copiedArtifacts: string[] = [];
  for (const entry of stageEntries) {
    const from = path.join(stageDistDir, entry);
    const stat = yield* fs.stat(from).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!stat || stat.type !== "File") continue;

    const to = path.join(options.outputDir, entry);
    yield* fs.copyFile(from, to);
    copiedArtifacts.push(to);
  }

  if (copiedArtifacts.length === 0) {
    return yield* new BuildScriptError({
      message: `Build completed but no files were produced in ${stageDistDir}`,
    });
  }

  yield* Effect.log("[desktop-artifact] Done. Artifacts:").pipe(
    Effect.annotateLogs({ artifacts: copiedArtifacts }),
  );
});
