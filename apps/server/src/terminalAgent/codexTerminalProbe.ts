import { Effect, Option } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { buildCodexProcessEnv } from "../codexProcessEnv";
import {
  compareCodexCliVersions,
  parseCodexCliVersion,
} from "../provider/codexCliVersion";
import { parseAuthStatusFromOutput } from "../provider/Layers/provider-health/providerAuthParsing";
import { runCodexCommand } from "../provider/Layers/provider-health/providerCommandRunner";
import type { TerminalAgentCapabilitySnapshot } from "./terminalAgentProtocol";
import { missingCliOption } from "./terminalAgentProbeSupport";

export const CODEX_TERMINAL_BASELINE_VERSION = "0.144.6";

interface ProbeCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

const REQUIRED_ROOT_OPTIONS = [
  "--dangerously-bypass-hook-trust",
  "--no-alt-screen",
  "--config",
  "--profile",
  "--enable",
  "--model",
  "--sandbox",
  "--ask-for-approval",
] as const;

function output(result: ProbeCommandResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function authMethod(result: ProbeCommandResult): string | null {
  const text = output(result).toLowerCase();
  if (text.includes("chatgpt")) return "chatgpt";
  if (text.includes("api key") || text.includes("api-key")) return "api-key";
  return null;
}

export function inspectCodexTerminalProbe(input: {
  readonly version: ProbeCommandResult;
  readonly help: ProbeCommandResult;
  readonly resumeHelp: ProbeCommandResult;
  readonly features: ProbeCommandResult;
  readonly auth: ProbeCommandResult;
}): TerminalAgentCapabilitySnapshot {
  const versionOutput = output(input.version);
  const version = parseCodexCliVersion(versionOutput);
  if (
    input.version.code !== 0 ||
    !version ||
    !/\bcodex(?:-cli)?\b/iu.test(versionOutput)
  ) {
    throw new Error("The configured executable is not a supported Codex CLI.");
  }
  if (
    compareCodexCliVersions(version, CODEX_TERMINAL_BASELINE_VERSION) < 0
  ) {
    throw new Error(
      `Codex Terminal requires CLI ${CODEX_TERMINAL_BASELINE_VERSION} or newer.`,
    );
  }

  const missingRootOption = missingCliOption(
    output(input.help),
    REQUIRED_ROOT_OPTIONS,
  );
  if (input.help.code !== 0 || missingRootOption) {
    throw new Error(
      missingRootOption
        ? `Codex CLI does not expose the required ${missingRootOption} capability.`
        : "Codex CLI capability discovery failed.",
    );
  }
  const missingResumeOption = missingCliOption(
    output(input.resumeHelp),
    REQUIRED_ROOT_OPTIONS,
  );
  if (
    input.resumeHelp.code !== 0 ||
    !/\bcodex resume\b/iu.test(output(input.resumeHelp)) ||
    missingResumeOption
  ) {
    throw new Error(
      missingResumeOption
        ? `Codex resume does not expose the required ${missingResumeOption} capability.`
        : "Codex resume capability discovery failed.",
    );
  }

  const featureOutput = output(input.features);
  if (
    input.features.code !== 0 ||
    !/^hooks\s+\S+\s+true\s*$/imu.test(featureOutput)
  ) {
    throw new Error("Codex hooks are unavailable or disabled.");
  }

  const auth = parseAuthStatusFromOutput(input.auth);
  if (auth.authStatus !== "authenticated") {
    throw new Error("Codex is not signed in. Run `codex login` and retry.");
  }
  return {
    cliVersion: version,
    authentication: "authenticated",
    authMethod: authMethod(input.auth),
    apiProvider: "openai",
    hookSchema: "cli-verified",
  };
}

export function probeCodexTerminal(
  executable: string,
  childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  codexHomePath?: string,
) {
  const env = buildCodexProcessEnv({
    ...(codexHomePath ? { homePath: codexHomePath } : {}),
  });
  const run = (args: ReadonlyArray<string>) =>
    runCodexCommand(args, executable, env).pipe(
      Effect.provideService(
        ChildProcessSpawner.ChildProcessSpawner,
        childProcessSpawner,
      ),
      Effect.timeoutOption("5 seconds"),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new Error("Codex CLI capability probe timed out.")),
          onSome: Effect.succeed,
        }),
      ),
    );
  return Effect.gen(function* () {
    const results = yield* Effect.all(
      {
        version: run(["--version"]),
        help: run(["--help"]),
        resumeHelp: run(["resume", "--help"]),
        features: run(["features", "list"]),
        auth: run(["login", "status"]),
      },
      { concurrency: "unbounded" },
    );
    return yield* Effect.try({
      try: () => inspectCodexTerminalProbe(results),
      catch: (cause) =>
        cause instanceof Error
          ? cause
          : new Error("Codex CLI capability probe failed."),
    });
  });
}
