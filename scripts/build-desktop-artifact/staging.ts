import { Effect, FileSystem, Path } from "effect";
import { ChildProcess } from "effect/unstable/process";

import {
  MAC_APPSNAP_HELPER_STAGE_PATH,
  TAILNET_SIDECAR_STAGE_PATH,
  TAILNET_SIDECAR_WINDOWS_STAGE_PATH,
} from "../lib/desktop-platform-build-config.ts";
import { BuildArch, BuildPlatform, BuildScriptError, RepoRoot } from "./model.ts";
import { commandOutputOptions, runCommand } from "./process.ts";

const NodePtySmokeScript = Effect.zipWith(RepoRoot, Effect.service(Path.Path), (repoRoot, path) =>
  path.join(repoRoot, "scripts/node-pty-smoke.mjs"),
);
const AppSnapHelperBuildScript = Effect.zipWith(
  RepoRoot,
  Effect.service(Path.Path),
  (repoRoot, path) => path.join(repoRoot, "apps/desktop/scripts/build-appsnap-helper.mjs"),
);
const TailnetSourceDir = Effect.zipWith(RepoRoot, Effect.service(Path.Path), (repoRoot, path) =>
  path.join(repoRoot, "apps/tailnet"),
);

export const verifyStagedNodePty = Effect.fn("verifyStagedNodePty")(function* (
  stageAppDir: string,
  verbose: boolean,
) {
  const smokeScript = yield* NodePtySmokeScript;
  yield* Effect.log("[desktop-artifact] Verifying staged node-pty native PTY...");
  yield* runCommand(
    ChildProcess.make({
      cwd: stageAppDir,
      env: {
        ...process.env,
        AGENT_GROUP_NODE_PTY_SMOKE_REQUIRE_ROOT: stageAppDir,
      },
      ...commandOutputOptions(verbose),
      shell: process.platform === "win32",
    })`node ${smokeScript}`,
  );
});

export const stageTailnetSidecar = Effect.fn("stageTailnetSidecar")(function* (
  stageAppDir: string,
  platform: typeof BuildPlatform.Type,
  arch: typeof BuildArch.Type,
  verbose: boolean,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sourceDir = yield* TailnetSourceDir;
  const relativeOutput =
    platform === "win" ? TAILNET_SIDECAR_WINDOWS_STAGE_PATH : TAILNET_SIDECAR_STAGE_PATH;
  const output = path.join(stageAppDir, relativeOutput);
  yield* fs.makeDirectory(path.dirname(output), { recursive: true });
  const goos = platform === "mac" ? "darwin" : platform === "win" ? "windows" : "linux";
  const buildForArch = (goarch: "arm64" | "amd64", target: string) =>
    runCommand(
      ChildProcess.make({
        cwd: sourceDir,
        env: { ...process.env, CGO_ENABLED: "0", GOOS: goos, GOARCH: goarch },
        ...commandOutputOptions(verbose),
      })`go build -trimpath -ldflags ${"-s -w"} -o ${target} ./cmd/agent-group-tailnet`,
    );

  yield* Effect.log(`[desktop-artifact] Building Tailnet sidecar (${goos}/${arch})...`);
  if (arch !== "universal") {
    yield* buildForArch(arch === "x64" ? "amd64" : "arm64", output);
    return;
  }

  const armOutput = `${output}.arm64`;
  const x64Output = `${output}.x64`;
  yield* buildForArch("arm64", armOutput);
  yield* buildForArch("amd64", x64Output);
  yield* runCommand(
    ChildProcess.make({
      ...commandOutputOptions(verbose),
    })`lipo -create ${armOutput} ${x64Output} -output ${output}`,
  );
  yield* fs.remove(armOutput);
  yield* fs.remove(x64Output);
});

export const stageMacAppSnapHelper = Effect.fn("stageMacAppSnapHelper")(function* (
  stageAppDir: string,
  arch: typeof BuildArch.Type,
  verbose: boolean,
) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const buildScript = yield* AppSnapHelperBuildScript;
  const outputPath = path.join(stageAppDir, MAC_APPSNAP_HELPER_STAGE_PATH);

  yield* fs.makeDirectory(path.dirname(outputPath), { recursive: true });
  yield* Effect.log(`[desktop-artifact] Building native AppSnap helper (${arch})...`);
  yield* runCommand(
    ChildProcess.make({
      cwd: stageAppDir,
      ...commandOutputOptions(verbose),
    })`node ${buildScript} --arch ${arch} --release --output ${outputPath}`,
  );

  if (!(yield* fs.exists(outputPath))) {
    return yield* new BuildScriptError({
      message: `AppSnap helper build completed but output was not found at ${outputPath}`,
    });
  }
});
