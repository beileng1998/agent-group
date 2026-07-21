import type {
  ServerProviderAuthStatus,
  ServerProviderStatus,
  ServerProviderStatusState,
} from "@agent-group/contracts";
import { Effect, Option, Result } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { resolveCursorAgentBinaryPath } from "../../acp/CursorAcpCommand";
import { detailFromResult, isCommandMissingCause, nonEmptyTrimmed } from "../../providerCliOutput";
import { compareSemverVersions, parseGenericCliVersion } from "../../providerMaintenance";
import { runAntigravityCommand, runCursorCommand } from "./providerCommandRunner";
import {
  ANTIGRAVITY_PROVIDER,
  CLAUDE_HEALTH_TIMEOUT_MS,
  CURSOR_PROVIDER,
  DEFAULT_TIMEOUT_MS,
  MINIMUM_ANTIGRAVITY_CLI_VERSION,
} from "./providerHealthConstants";

export const checkAntigravityProviderStatus = (
  binaryPath?: string,
): Effect.Effect<ServerProviderStatus, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const checkedAt = new Date().toISOString();
    const executable = nonEmptyTrimmed(binaryPath) ?? "agy";
    const versionProbe = yield* runAntigravityCommand(["--version"], executable).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );
    if (Result.isFailure(versionProbe)) {
      return {
        provider: ANTIGRAVITY_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: isCommandMissingCause(versionProbe.failure)
          ? "Antigravity CLI (`agy`) is not installed or is not on PATH."
          : `Antigravity CLI health check failed: ${String(versionProbe.failure)}`,
      } satisfies ServerProviderStatus;
    }
    if (Option.isNone(versionProbe.success)) {
      return {
        provider: ANTIGRAVITY_PROVIDER,
        status: "warning",
        available: true,
        authStatus: "unknown",
        checkedAt,
        message: "Antigravity CLI version check timed out.",
      } satisfies ServerProviderStatus;
    }
    const version = versionProbe.success.value;
    if (version.code !== 0) {
      return {
        provider: ANTIGRAVITY_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: detailFromResult(version) ?? "Antigravity CLI version check failed.",
      } satisfies ServerProviderStatus;
    }
    const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
    if (
      parsedVersion !== null &&
      compareSemverVersions(parsedVersion, MINIMUM_ANTIGRAVITY_CLI_VERSION) < 0
    ) {
      return {
        provider: ANTIGRAVITY_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        version: parsedVersion,
        checkedAt,
        message: `Antigravity CLI ${parsedVersion} is too old for Agent Group. Upgrade to ${MINIMUM_ANTIGRAVITY_CLI_VERSION} or newer.`,
      } satisfies ServerProviderStatus;
    }
    const models = yield* runAntigravityCommand(["models"], executable).pipe(
      Effect.timeoutOption(CLAUDE_HEALTH_TIMEOUT_MS),
      Effect.result,
    );
    if (
      Result.isSuccess(models) &&
      Option.isSome(models.success) &&
      models.success.value.code === 0 &&
      models.success.value.stdout.trim().length > 0
    ) {
      return {
        provider: ANTIGRAVITY_PROVIDER,
        status: "ready",
        available: true,
        authStatus: "authenticated",
        version: parsedVersion,
        checkedAt,
        message: "Antigravity CLI is installed, authenticated, and returned available models.",
      } satisfies ServerProviderStatus;
    }
    return {
      provider: ANTIGRAVITY_PROVIDER,
      status: "warning",
      available: true,
      authStatus: "unknown",
      version: parsedVersion,
      checkedAt,
      message:
        "Antigravity CLI is installed, but Agent Group could not verify login by listing models.",
    } satisfies ServerProviderStatus;
  });

function parseCursorAuthStatusFromOutput(result: {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}): {
  readonly status: ServerProviderStatusState;
  readonly authStatus: ServerProviderAuthStatus;
  readonly message?: string;
} {
  const output = `${result.stdout}\n${result.stderr}`;
  const lowerOutput = output.toLowerCase();
  if (
    lowerOutput.includes("unknown command") ||
    lowerOutput.includes("unrecognized command") ||
    lowerOutput.includes("unexpected argument")
  ) {
    return {
      status: "warning",
      authStatus: "unknown",
      message:
        "Cursor Agent authentication status command is unavailable in this Cursor Agent version.",
    };
  }
  if (
    lowerOutput.includes("authentication required") ||
    lowerOutput.includes("not logged in") ||
    lowerOutput.includes("not authenticated") ||
    lowerOutput.includes("unauthenticated") ||
    lowerOutput.includes("login required") ||
    lowerOutput.includes("run 'agent login'") ||
    lowerOutput.includes("run `agent login`") ||
    lowerOutput.includes("run cursor-agent login")
  ) {
    return {
      status: "error",
      authStatus: "unauthenticated",
      message: "Cursor Agent is not authenticated. Run `cursor-agent login` and try again.",
    };
  }
  if (
    lowerOutput.includes("logged in") ||
    lowerOutput.includes("login successful") ||
    lowerOutput.includes("authenticated")
  ) {
    return { status: "ready", authStatus: "authenticated" };
  }
  if (result.code === 0) {
    return {
      status: "warning",
      authStatus: "unknown",
      message: "Cursor Agent is installed, but Agent Group could not verify authentication status.",
    };
  }
  const detail = detailFromResult(result);
  return {
    status: "warning",
    authStatus: "unknown",
    message: detail
      ? `Could not verify Cursor Agent authentication status. ${detail}`
      : "Could not verify Cursor Agent authentication status.",
  };
}

function cursorModelsOutputHasModels(output: string): boolean {
  return output.split(/\r?\n/u).some((line) => line.trim().length > 0 && line.includes(" - "));
}

function cursorModelsOutputHasNoModels(output: string): boolean {
  return output.toLowerCase().includes("no models available");
}

export const makeCheckCursorProviderStatus = (
  binaryPath?: string,
): Effect.Effect<ServerProviderStatus, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const checkedAt = new Date().toISOString();
    const executable = resolveCursorAgentBinaryPath(nonEmptyTrimmed(binaryPath));
    const versionProbe = yield* runCursorCommand(["--version"], executable).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );
    if (Result.isFailure(versionProbe)) {
      const error = versionProbe.failure;
      return {
        provider: CURSOR_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: isCommandMissingCause(error)
          ? "Cursor Agent CLI (`cursor-agent`) is not installed or not on PATH."
          : `Failed to execute Cursor Agent CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      } satisfies ServerProviderStatus;
    }
    if (Option.isNone(versionProbe.success)) {
      return {
        provider: CURSOR_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message:
          "Cursor Agent CLI is installed but failed to run. Timed out while running command.",
      } satisfies ServerProviderStatus;
    }
    const version = versionProbe.success.value;
    if (version.code !== 0) {
      const detail = detailFromResult(version);
      return {
        provider: CURSOR_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: detail
          ? `Cursor Agent CLI is installed but failed to run. ${detail}`
          : "Cursor Agent CLI is installed but failed to run.",
      } satisfies ServerProviderStatus;
    }
    const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
    const authProbe = yield* runCursorCommand(["status"], executable).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );
    if (Result.isFailure(authProbe)) {
      const error = authProbe.failure;
      return {
        provider: CURSOR_PROVIDER,
        status: "warning",
        available: true,
        authStatus: "unknown",
        version: parsedVersion,
        checkedAt,
        message:
          error instanceof Error
            ? `Could not verify Cursor Agent authentication status: ${error.message}.`
            : "Could not verify Cursor Agent authentication status.",
      } satisfies ServerProviderStatus;
    }
    if (Option.isNone(authProbe.success)) {
      return {
        provider: CURSOR_PROVIDER,
        status: "warning",
        available: true,
        authStatus: "unknown",
        version: parsedVersion,
        checkedAt,
        message:
          "Could not verify Cursor Agent authentication status. Timed out while running command.",
      } satisfies ServerProviderStatus;
    }
    const parsedAuth = parseCursorAuthStatusFromOutput(authProbe.success.value);
    if (parsedAuth.authStatus !== "authenticated") {
      return {
        provider: CURSOR_PROVIDER,
        status: parsedAuth.status,
        available: true,
        authStatus: parsedAuth.authStatus,
        version: parsedVersion,
        checkedAt,
        ...(parsedAuth.message ? { message: parsedAuth.message } : {}),
      } satisfies ServerProviderStatus;
    }

    const modelsProbe = yield* runCursorCommand(["models"], executable).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );
    if (Result.isFailure(modelsProbe)) {
      const error = modelsProbe.failure;
      return {
        provider: CURSOR_PROVIDER,
        status: "warning",
        available: true,
        authStatus: "authenticated",
        version: parsedVersion,
        checkedAt,
        message:
          error instanceof Error
            ? `Cursor Agent is authenticated, but model discovery failed: ${error.message}.`
            : "Cursor Agent is authenticated, but model discovery failed.",
      } satisfies ServerProviderStatus;
    }
    if (Option.isNone(modelsProbe.success)) {
      return {
        provider: CURSOR_PROVIDER,
        status: "warning",
        available: true,
        authStatus: "authenticated",
        version: parsedVersion,
        checkedAt,
        message:
          "Cursor Agent is authenticated, but model discovery timed out before Agent Group could verify available models.",
      } satisfies ServerProviderStatus;
    }
    const modelsResult = modelsProbe.success.value;
    const modelsOutput = `${modelsResult.stdout}\n${modelsResult.stderr}`;
    const modelAuth = parseCursorAuthStatusFromOutput(modelsResult);
    if (modelAuth.authStatus === "unauthenticated") {
      return {
        provider: CURSOR_PROVIDER,
        status: modelAuth.status,
        available: true,
        authStatus: modelAuth.authStatus,
        version: parsedVersion,
        checkedAt,
        ...(modelAuth.message ? { message: modelAuth.message } : {}),
      } satisfies ServerProviderStatus;
    }
    if (cursorModelsOutputHasNoModels(modelsOutput)) {
      return {
        provider: CURSOR_PROVIDER,
        status: "error",
        available: false,
        authStatus: "authenticated",
        version: parsedVersion,
        checkedAt,
        message:
          "Cursor Agent is authenticated, but it reports no models available for this account.",
      } satisfies ServerProviderStatus;
    }
    if (modelsResult.code !== 0) {
      const detail = detailFromResult(modelsResult);
      return {
        provider: CURSOR_PROVIDER,
        status: "warning",
        available: true,
        authStatus: "authenticated",
        version: parsedVersion,
        checkedAt,
        message: detail
          ? `Cursor Agent is authenticated, but model discovery failed. ${detail}`
          : "Cursor Agent is authenticated, but model discovery failed.",
      } satisfies ServerProviderStatus;
    }
    if (!cursorModelsOutputHasModels(modelsOutput)) {
      return {
        provider: CURSOR_PROVIDER,
        status: "warning",
        available: true,
        authStatus: "authenticated",
        version: parsedVersion,
        checkedAt,
        message:
          "Cursor Agent is authenticated, but model discovery returned no recognizable model rows.",
      } satisfies ServerProviderStatus;
    }
    return {
      provider: CURSOR_PROVIDER,
      status: "ready",
      available: true,
      authStatus: "authenticated",
      version: parsedVersion,
      checkedAt,
    } satisfies ServerProviderStatus;
  });

export const checkCursorProviderStatus = makeCheckCursorProviderStatus();
