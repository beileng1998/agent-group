import { Effect, Option } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { buildClaudeProcessEnv } from "../provider/claudeProcessEnv";
import { runClaudeCommand } from "../provider/Layers/provider-health/providerCommandRunner";
import { CLAUDE_DISABLE_AUTOUPDATER_ENV } from "./claudeTerminalDriver";
import type { TerminalAgentCapabilitySnapshot } from "./terminalAgentProtocol";

interface ProbeCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

const REQUIRED_CLI_OPTIONS = [
  "--settings",
  "--session-id",
  "--model",
  "--effort",
  "--permission-mode",
] as const;

function output(result: ProbeCommandResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function inspectClaudeTerminalProbe(input: {
  readonly version: ProbeCommandResult;
  readonly help: ProbeCommandResult;
  readonly auth: ProbeCommandResult;
}): TerminalAgentCapabilitySnapshot {
  const versionOutput = output(input.version);
  const version = /(\d+\.\d+\.\d+)/u.exec(versionOutput)?.[1];
  if (
    input.version.code !== 0 ||
    !version ||
    !/Claude Code/iu.test(versionOutput)
  ) {
    throw new Error("The configured executable is not a supported Claude Code CLI.");
  }

  const helpOutput = output(input.help);
  const missingOption = REQUIRED_CLI_OPTIONS.find(
    (option) => !helpOutput.includes(option),
  );
  if (input.help.code !== 0 || missingOption || !/\bmanual\b/u.test(helpOutput)) {
    throw new Error(
      missingOption
        ? `Claude Code does not expose the required ${missingOption} capability.`
        : !/\bmanual\b/u.test(helpOutput)
          ? "Claude Code does not expose manual permission mode."
          : "Claude Code capability discovery failed.",
    );
  }

  const auth = parseJsonObject(output(input.auth));
  if (input.auth.code !== 0 || auth?.loggedIn !== true) {
    throw new Error("Claude Code is not signed in. Run `claude auth login` and retry.");
  }
  return {
    cliVersion: version,
    authentication: "authenticated",
    authMethod: typeof auth.authMethod === "string" ? auth.authMethod : null,
    apiProvider: typeof auth.apiProvider === "string" ? auth.apiProvider : null,
    hookSchema: "cli-verified",
  };
}

export function probeClaudeTerminal(
  executable: string,
  childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
) {
  const env = {
    ...buildClaudeProcessEnv(),
    [CLAUDE_DISABLE_AUTOUPDATER_ENV]: "1",
  };
  const run = (args: ReadonlyArray<string>) =>
    runClaudeCommand(args, executable, env).pipe(
      Effect.provideService(
        ChildProcessSpawner.ChildProcessSpawner,
        childProcessSpawner,
      ),
      Effect.timeoutOption("5 seconds"),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new Error("Claude CLI capability probe timed out.")),
          onSome: Effect.succeed,
        }),
      ),
    );
  return Effect.gen(function* () {
    const results = {
      version: yield* run(["--version"]),
      help: yield* run(["--help"]),
      auth: yield* run(["auth", "status", "--json"]),
    };
    return yield* Effect.try({
      try: () => inspectClaudeTerminalProbe(results),
      catch: (cause) =>
        cause instanceof Error
          ? cause
          : new Error("Claude CLI capability probe failed."),
    });
  });
}
