import type { ServerProviderStatus } from "@agent-group/contracts";
import { Effect, Option, Result } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { resolveDroidCliBinaryPath, hasDroidApiKeyEnv } from "../../acp/DroidAcpSupport";
import { hasGrokApiKeyEnv } from "../../acp/GrokAcpSupport";
import {
  detailFromResult,
  isCommandMissingCause,
  nonEmptyTrimmed,
  PROVIDER_COMMAND_TIMEOUT_DETAIL,
} from "../../providerCliOutput";
import { parseGenericCliVersion } from "../../providerMaintenance";
import {
  runDroidCommand,
  runGrokCommand,
  runKiloCommand,
  runOpenCodeCommand,
  runPiCommand,
} from "./providerCommandRunner";
import {
  DEFAULT_TIMEOUT_MS,
  DROID_PROVIDER,
  GROK_PROVIDER,
  KILO_PROVIDER,
  OPENCODE_HEALTH_TIMEOUT_MS,
  OPENCODE_PROVIDER,
  PI_PROVIDER,
} from "./providerHealthConstants";

export const makeCheckGrokProviderStatus = (
  binaryPath?: string,
): Effect.Effect<ServerProviderStatus, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const checkedAt = new Date().toISOString();
    const executable = nonEmptyTrimmed(binaryPath) ?? "grok";
    const versionProbe = yield* runGrokCommand(["--version"], executable).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );
    if (Result.isFailure(versionProbe)) {
      const error = versionProbe.failure;
      return {
        provider: GROK_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: isCommandMissingCause(error)
          ? "Grok CLI (`grok`) is not installed or not on PATH."
          : `Failed to execute Grok CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      } satisfies ServerProviderStatus;
    }
    if (Option.isNone(versionProbe.success)) {
      return {
        provider: GROK_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: "Grok CLI is installed but failed to run. Timed out while running command.",
      } satisfies ServerProviderStatus;
    }
    const version = versionProbe.success.value;
    if (version.code !== 0) {
      const detail = detailFromResult(version);
      return {
        provider: GROK_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: detail
          ? `Grok CLI is installed but failed to run. ${detail}`
          : "Grok CLI is installed but failed to run.",
      } satisfies ServerProviderStatus;
    }
    const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
    const hasApiKey = hasGrokApiKeyEnv();
    return {
      provider: GROK_PROVIDER,
      status: "ready",
      available: true,
      authStatus: hasApiKey ? "authenticated" : "unknown",
      version: parsedVersion,
      checkedAt,
      ...(hasApiKey
        ? { authType: "apiKey", authLabel: "xAI API Key" }
        : {
            message:
              "Grok CLI is installed. Run `grok` to authenticate locally, or set XAI_API_KEY before starting a session.",
          }),
    } satisfies ServerProviderStatus;
  });

export const checkGrokProviderStatus = makeCheckGrokProviderStatus();

export const makeCheckDroidProviderStatus = (
  binaryPath?: string,
): Effect.Effect<ServerProviderStatus, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const checkedAt = new Date().toISOString();
    const executable = resolveDroidCliBinaryPath(nonEmptyTrimmed(binaryPath) ?? undefined);
    const versionProbe = yield* runDroidCommand(["--version"], executable).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );
    if (Result.isFailure(versionProbe)) {
      const error = versionProbe.failure;
      return {
        provider: DROID_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: isCommandMissingCause(error)
          ? "Droid CLI (`droid`) is not installed or not on PATH."
          : `Failed to execute Droid CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      } satisfies ServerProviderStatus;
    }
    if (Option.isNone(versionProbe.success)) {
      return {
        provider: DROID_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: "Droid CLI is installed but failed to run. Timed out while running command.",
      } satisfies ServerProviderStatus;
    }
    const version = versionProbe.success.value;
    if (version.code !== 0) {
      const detail = detailFromResult(version);
      return {
        provider: DROID_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: detail
          ? `Droid CLI is installed but failed to run. ${detail}`
          : "Droid CLI is installed but failed to run.",
      } satisfies ServerProviderStatus;
    }
    const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
    const hasApiKey = hasDroidApiKeyEnv();
    return {
      provider: DROID_PROVIDER,
      status: "ready",
      available: true,
      authStatus: hasApiKey ? "authenticated" : "unknown",
      version: parsedVersion,
      checkedAt,
      ...(hasApiKey
        ? { authType: "apiKey", authLabel: "Factory API Key" }
        : {
            message:
              "Droid CLI is installed. Agent Group can use the CLI's cached device-pairing login; run `droid` to authenticate locally if needed, or set FACTORY_API_KEY.",
          }),
    } satisfies ServerProviderStatus;
  });

export const checkDroidProviderStatus = makeCheckDroidProviderStatus();

export const makeCheckOpenCodeProviderStatus = (
  binaryPath?: string,
): Effect.Effect<ServerProviderStatus, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const checkedAt = new Date().toISOString();
    const executable = nonEmptyTrimmed(binaryPath) ?? "opencode";
    const versionProbe = yield* runOpenCodeCommand(["--version"], executable).pipe(
      Effect.timeoutOption(OPENCODE_HEALTH_TIMEOUT_MS),
      Effect.result,
    );
    if (Result.isFailure(versionProbe)) {
      const error = versionProbe.failure;
      return {
        provider: OPENCODE_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: isCommandMissingCause(error)
          ? "OpenCode CLI (`opencode`) is not installed or not on PATH."
          : `Failed to execute OpenCode CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      } satisfies ServerProviderStatus;
    }
    if (Option.isNone(versionProbe.success)) {
      return {
        provider: OPENCODE_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: `OpenCode CLI is installed but failed to run. ${PROVIDER_COMMAND_TIMEOUT_DETAIL}`,
      } satisfies ServerProviderStatus;
    }
    const version = versionProbe.success.value;
    if (version.code !== 0) {
      const detail = detailFromResult(version);
      return {
        provider: OPENCODE_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: detail
          ? `OpenCode CLI is installed but failed to run. ${detail}`
          : "OpenCode CLI is installed but failed to run.",
      } satisfies ServerProviderStatus;
    }
    return {
      provider: OPENCODE_PROVIDER,
      status: "ready",
      available: true,
      authStatus: "unknown",
      version: parseGenericCliVersion(`${version.stdout}\n${version.stderr}`),
      checkedAt,
      message:
        "OpenCode CLI is installed. Configure provider credentials inside OpenCode as needed.",
    } satisfies ServerProviderStatus;
  });

export const checkOpenCodeProviderStatus = makeCheckOpenCodeProviderStatus();

export const makeCheckKiloProviderStatus = (
  binaryPath?: string,
): Effect.Effect<ServerProviderStatus, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const checkedAt = new Date().toISOString();
    const executable = nonEmptyTrimmed(binaryPath) ?? "kilo";
    const versionProbe = yield* runKiloCommand(["--version"], executable).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );
    if (Result.isFailure(versionProbe)) {
      const error = versionProbe.failure;
      return {
        provider: KILO_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: isCommandMissingCause(error)
          ? "Kilo CLI (`kilo`) is not installed or not on PATH."
          : `Failed to execute Kilo CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      } satisfies ServerProviderStatus;
    }
    if (Option.isNone(versionProbe.success)) {
      return {
        provider: KILO_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: "Kilo CLI is installed but failed to run. Timed out while running command.",
      } satisfies ServerProviderStatus;
    }
    const version = versionProbe.success.value;
    if (version.code !== 0) {
      const detail = detailFromResult(version);
      return {
        provider: KILO_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: detail
          ? `Kilo CLI is installed but failed to run. ${detail}`
          : "Kilo CLI is installed but failed to run.",
      } satisfies ServerProviderStatus;
    }
    return {
      provider: KILO_PROVIDER,
      status: "ready",
      available: true,
      authStatus: "unknown",
      version: parseGenericCliVersion(`${version.stdout}\n${version.stderr}`),
      checkedAt,
      message: "Kilo CLI is installed. Configure provider credentials inside Kilo as needed.",
    } satisfies ServerProviderStatus;
  });

export const checkKiloProviderStatus = makeCheckKiloProviderStatus();

export const checkPiProviderStatus = (
  agentDir?: string,
  binaryPath?: string,
): Effect.Effect<ServerProviderStatus, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const checkedAt = new Date().toISOString();
    const executable = nonEmptyTrimmed(binaryPath) ?? "pi";
    const versionProbe = yield* runPiCommand(["--version"], executable).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );
    if (Result.isFailure(versionProbe)) {
      const error = versionProbe.failure;
      return {
        provider: PI_PROVIDER,
        status: "warning",
        available: true,
        authStatus: "unknown",
        checkedAt,
        message: isCommandMissingCause(error)
          ? "Pi SDK is bundled, but the Pi CLI (`pi`) is not on PATH, so Agent Group could not verify the installed CLI version."
          : `Pi SDK is bundled, but the CLI health check failed: ${error instanceof Error ? error.message : String(error)}.`,
      } satisfies ServerProviderStatus;
    }
    if (Option.isNone(versionProbe.success)) {
      return {
        provider: PI_PROVIDER,
        status: "warning",
        available: true,
        authStatus: "unknown",
        checkedAt,
        message:
          "Pi SDK is bundled, but the CLI health check timed out before Agent Group could verify the installed version.",
      } satisfies ServerProviderStatus;
    }
    const version = versionProbe.success.value;
    if (version.code !== 0) {
      const detail = detailFromResult(version);
      return {
        provider: PI_PROVIDER,
        status: "warning",
        available: true,
        authStatus: "unknown",
        checkedAt,
        message: detail
          ? `Pi SDK is bundled, but the CLI health check failed. ${detail}`
          : "Pi SDK is bundled, but the CLI health check failed.",
      } satisfies ServerProviderStatus;
    }
    const configuredAgentDir = nonEmptyTrimmed(agentDir);
    return {
      provider: PI_PROVIDER,
      status: "ready",
      available: true,
      authStatus: "unknown",
      version: parseGenericCliVersion(`${version.stdout}\n${version.stderr}`),
      checkedAt,
      message: configuredAgentDir
        ? `Pi CLI is installed. Agent Group will use Pi agent dir ${configuredAgentDir}.`
        : "Pi CLI is installed. Configure provider credentials inside Pi as needed.",
    } satisfies ServerProviderStatus;
  });
