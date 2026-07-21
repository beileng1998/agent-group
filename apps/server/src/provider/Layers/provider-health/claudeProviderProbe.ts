import type { ServerProviderStatus } from "@agent-group/contracts";
import { Effect, Option, Result } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import {
  claudeAuthMetadata,
  isStructuredClaudeAuthFalseNegativeCandidate,
  parseClaudeAuthStatusFromOutput,
} from "../../claudeAuthStatus";
import { acquireClaudeAuthStatusLock } from "../../claudeAuthStatusLock";
import { buildClaudeProcessEnv, readClaudeCliCredentialsSummary } from "../../claudeProcessEnv";
import { detailFromResult, isCommandMissingCause, nonEmptyTrimmed } from "../../providerCliOutput";
import { parseGenericCliVersion } from "../../providerMaintenance";
import {
  extractClaudeAuthMethodFromOutput,
  extractSubscriptionTypeFromOutput,
} from "./providerAuthParsing";
import { runClaudeCommand } from "./providerCommandRunner";
import { CLAUDE_AGENT_PROVIDER, CLAUDE_HEALTH_TIMEOUT_MS } from "./providerHealthConstants";

const CLAUDE_AUTH_FALSE_NEGATIVE_RETRY_DELAY_MS = 1_000;

export const makeCheckClaudeProviderStatus = (
  resolveSubscriptionType?: Effect.Effect<string | undefined>,
  binaryPath?: string,
  homeDir?: string,
  options?: { readonly falseNegativeRetryDelayMs?: number },
): Effect.Effect<ServerProviderStatus, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const checkedAt = new Date().toISOString();
    const executable = nonEmptyTrimmed(binaryPath) ?? "claude";
    const claudeEnv = buildClaudeProcessEnv(
      homeDir ? { env: process.env, homeDir } : { env: process.env },
    );
    const versionProbe = yield* runClaudeCommand(["--version"], executable, claudeEnv).pipe(
      Effect.timeoutOption(CLAUDE_HEALTH_TIMEOUT_MS),
      Effect.result,
    );

    if (Result.isFailure(versionProbe)) {
      const error = versionProbe.failure;
      return {
        provider: CLAUDE_AGENT_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: isCommandMissingCause(error)
          ? "Claude Agent CLI (`claude`) is not installed or not on PATH."
          : `Failed to execute Claude Agent CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      };
    }
    if (Option.isNone(versionProbe.success)) {
      return {
        provider: CLAUDE_AGENT_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message:
          "Claude Agent CLI is installed but failed to run. Timed out while running command.",
      };
    }
    const version = versionProbe.success.value;
    if (version.code !== 0) {
      const detail = detailFromResult(version);
      return {
        provider: CLAUDE_AGENT_PROVIDER,
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        message: detail
          ? `Claude Agent CLI is installed but failed to run. ${detail}`
          : "Claude Agent CLI is installed but failed to run.",
      };
    }
    const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);

    const runAuthStatusProbe = Effect.acquireUseRelease(
      Effect.promise(() => acquireClaudeAuthStatusLock()),
      () =>
        runClaudeCommand(["auth", "status"], executable, claudeEnv).pipe(
          Effect.timeoutOption(CLAUDE_HEALTH_TIMEOUT_MS),
        ),
      (release) => Effect.sync(release),
    ).pipe(Effect.result);
    const authProbe = yield* runAuthStatusProbe;

    if (Result.isFailure(authProbe)) {
      const error = authProbe.failure;
      return {
        provider: CLAUDE_AGENT_PROVIDER,
        status: "warning",
        available: true,
        authStatus: "unknown",
        version: parsedVersion,
        checkedAt,
        message:
          error instanceof Error
            ? `Could not verify Claude authentication status: ${error.message}.`
            : "Could not verify Claude authentication status.",
      };
    }
    if (Option.isNone(authProbe.success)) {
      return {
        provider: CLAUDE_AGENT_PROVIDER,
        status: "warning",
        available: true,
        authStatus: "unknown",
        version: parsedVersion,
        checkedAt,
        message: "Could not verify Claude authentication status. Timed out while running command.",
      };
    }

    let authOutput = authProbe.success.value;
    let parsed = parseClaudeAuthStatusFromOutput(authOutput);
    const credentialSummary = readClaudeCliCredentialsSummary(
      homeDir ? { env: claudeEnv, homeDir } : { env: claudeEnv },
    );
    if (
      !credentialSummary.usable &&
      isStructuredClaudeAuthFalseNegativeCandidate(authOutput, parsed)
    ) {
      const retryDelayMs =
        options?.falseNegativeRetryDelayMs ?? CLAUDE_AUTH_FALSE_NEGATIVE_RETRY_DELAY_MS;
      if (retryDelayMs > 0) yield* Effect.sleep(retryDelayMs);
      const retryProbe = yield* runAuthStatusProbe;
      if (Result.isSuccess(retryProbe) && Option.isSome(retryProbe.success)) {
        authOutput = retryProbe.success.value;
        parsed = parseClaudeAuthStatusFromOutput(authOutput);
      }
    }

    const structuredFalseNegative = isStructuredClaudeAuthFalseNegativeCandidate(
      authOutput,
      parsed,
    );
    const credentialProbeSubscriptionType =
      credentialSummary.usable && structuredFalseNegative && resolveSubscriptionType
        ? yield* resolveSubscriptionType
        : undefined;
    const effectiveParsed: ReturnType<typeof parseClaudeAuthStatusFromOutput> =
      credentialProbeSubscriptionType !== undefined
        ? { status: "ready", authStatus: "authenticated" }
        : parsed;
    const useCredentialMetadata = credentialProbeSubscriptionType !== undefined;
    let subscriptionType =
      extractSubscriptionTypeFromOutput(authOutput) ??
      credentialProbeSubscriptionType ??
      (useCredentialMetadata ? credentialSummary.subscriptionType : undefined);
    const authMethod =
      extractClaudeAuthMethodFromOutput(authOutput) ??
      (useCredentialMetadata ? "claude.ai" : undefined);
    if (
      !subscriptionType &&
      resolveSubscriptionType &&
      effectiveParsed.authStatus === "authenticated"
    ) {
      subscriptionType = yield* resolveSubscriptionType;
    }
    const authMetadata = claudeAuthMetadata({ subscriptionType, authMethod });

    return {
      provider: CLAUDE_AGENT_PROVIDER,
      status: effectiveParsed.status,
      available: true,
      authStatus: effectiveParsed.authStatus,
      version: parsedVersion,
      ...(authMetadata ? { authType: authMetadata.type, authLabel: authMetadata.label } : {}),
      checkedAt,
      ...(effectiveParsed.message ? { message: effectiveParsed.message } : {}),
    } satisfies ServerProviderStatus;
  });

export const checkClaudeProviderStatus = makeCheckClaudeProviderStatus();
