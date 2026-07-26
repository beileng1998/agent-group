import type { PiModelSelection } from "@agent-group/contracts";
import { Effect, Option } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { runPiCommand } from "../provider/Layers/provider-health/providerCommandRunner";
import type { TerminalAgentCapabilitySnapshot } from "./terminalAgentProtocol";
import { missingCliOption } from "./terminalAgentProbeSupport";

interface ProbeCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

const MINIMUM_VERSION = [0, 80, 10] as const;
const REQUIRED_CLI_OPTIONS = [
  "--session",
  "--session-id",
  "--session-dir",
  "--extension",
  "--no-extensions",
  "--model",
  "--thinking",
  "--list-models",
] as const;

function output(result: ProbeCommandResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function parseVersion(value: string): ReadonlyArray<number> | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/u.exec(value);
  return match ? match.slice(1).map(Number) : undefined;
}

function versionIsSupported(version: ReadonlyArray<number>): boolean {
  for (let index = 0; index < MINIMUM_VERSION.length; index += 1) {
    const difference = (version[index] ?? 0) - (MINIMUM_VERSION[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

function parseAvailableModels(text: string) {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u))
    .filter((columns) => columns.length >= 2 && columns[0] !== "provider" && columns[0] !== "No")
    .flatMap(([provider, model]) => (provider && model ? [{ provider, model }] : []));
}

function resolveSelectedModel(
  modelReference: string,
  rows: ReturnType<typeof parseAvailableModels>,
) {
  const separator = modelReference.indexOf("/");
  if (separator > 0) {
    const provider = modelReference.slice(0, separator);
    const model = modelReference.slice(separator + 1);
    return rows.find((row) => row.provider === provider && row.model === model);
  }
  const matches = rows.filter((row) => row.model === modelReference);
  return matches.length === 1 ? matches[0] : undefined;
}

export function inspectPiTerminalProbe(input: {
  readonly version: ProbeCommandResult;
  readonly help: ProbeCommandResult;
  readonly models: ProbeCommandResult;
  readonly modelSelection: PiModelSelection;
}): TerminalAgentCapabilitySnapshot {
  const versionOutput = output(input.version);
  const parsedVersion = parseVersion(versionOutput);
  if (input.version.code !== 0 || !parsedVersion || !versionIsSupported(parsedVersion)) {
    throw new Error("Pi 0.80.10 or newer is required.");
  }

  const helpOutput = output(input.help);
  const missingOption = missingCliOption(helpOutput, REQUIRED_CLI_OPTIONS);
  if (input.help.code !== 0 || missingOption) {
    throw new Error(
      missingOption
        ? `Pi does not expose the required ${missingOption} capability.`
        : "Pi capability discovery failed.",
    );
  }

  const selectedModel =
    input.models.code === 0
      ? resolveSelectedModel(input.modelSelection.model, parseAvailableModels(output(input.models)))
      : undefined;
  if (!selectedModel) {
    throw new Error(`Pi cannot authenticate the selected model '${input.modelSelection.model}'.`);
  }
  return {
    cliVersion: parsedVersion.join("."),
    authentication: "authenticated",
    authMethod: "model-registry",
    apiProvider: selectedModel.provider,
    hookSchema: "cli-verified",
  };
}

export function probePiTerminal(
  executable: string,
  modelSelection: PiModelSelection,
  childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
) {
  const run = (args: ReadonlyArray<string>) =>
    runPiCommand(args, executable).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
      Effect.timeoutOption("5 seconds"),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new Error("Pi CLI capability probe timed out.")),
          onSome: Effect.succeed,
        }),
      ),
    );
  return Effect.gen(function* () {
    const results = {
      version: yield* run(["--version"]),
      help: yield* run(["--help"]),
      models: yield* run(["--list-models", modelSelection.model]),
      modelSelection,
    };
    return yield* Effect.try({
      try: () => inspectPiTerminalProbe(results),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error("Pi CLI capability probe failed."),
    });
  });
}
