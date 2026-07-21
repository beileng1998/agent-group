import * as OS from "node:os";
import type {
  ProviderKind,
  ServerProviderUpdateError as ServerProviderUpdateErrorType,
  ServerProviderUpdateState,
} from "@agent-group/contracts";
import { ServerProviderUpdateError } from "@agent-group/contracts";
import { prepareWindowsSafeProcess } from "@agent-group/shared/windowsProcess";
import { DateTime, Duration, Effect, Option, Result } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type { ServerSettingsShape } from "../../../serverSettings";
import { collectUint8StreamText } from "../../../stream/collectUint8StreamText";
import type { ProviderHealthShape } from "../../Services/ProviderHealth";
import type { ProviderMaintenanceCommandCoordinatorShape } from "../../providerMaintenanceCommandCoordinator";
import type { ProviderMaintenanceCapabilities } from "../../providerMaintenance";
import {
  PROVIDER_UPDATE_TIMEOUT_MS,
  UPDATE_OUTPUT_MAX_BYTES,
  type ProviderStatuses,
} from "./providerHealthConstants";
import { formatProviderUpdateTimeout } from "./providerUpdateDefinitions";
import { isProviderEnabledForSettings } from "./providerStatusProjection";

export function makeProviderUpdater(input: {
  readonly providerUpdateTimeoutMs?: number;
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly serverSettings: ServerSettingsShape;
  readonly getProviderMaintenanceCapabilities: (
    provider: ProviderKind,
  ) => Effect.Effect<ProviderMaintenanceCapabilities, unknown>;
  readonly setProviderUpdateState: (
    provider: ProviderKind,
    state: ServerProviderUpdateState | null,
  ) => Effect.Effect<ProviderStatuses>;
  readonly refreshNow: Effect.Effect<ProviderStatuses, unknown>;
  readonly commandCoordinator: ProviderMaintenanceCommandCoordinatorShape<ServerProviderUpdateErrorType>;
}): ProviderHealthShape["updateProvider"] {
  const providerUpdateTimeoutMs = input.providerUpdateTimeoutMs ?? PROVIDER_UPDATE_TIMEOUT_MS;
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const makeUpdateState = (state: {
    readonly status: ServerProviderUpdateState["status"];
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
    readonly message: string | null;
    readonly output?: string | null;
  }): ServerProviderUpdateState => ({
    status: state.status,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    message: state.message,
    output: state.output ?? null,
  });

  const describeUpdateCommandError = (error: unknown): string => {
    if (error instanceof Error && error.message.trim().length > 0) {
      if (error.message.includes("initial is not a function")) {
        return "Update command failed before producing output. Try running the provider update command from a terminal.";
      }
      return error.message;
    }
    if (typeof error === "string" && error.trim().length > 0) return error;
    return "Update command could not be started.";
  };

  const runUpdateCommand = Effect.fn("runProviderUpdateCommand")(function* (commandInput: {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly pathPrepend?: string;
  }) {
    const updateEnv = commandInput.pathPrepend
      ? {
          ...process.env,
          PATH: [commandInput.pathPrepend, process.env.PATH]
            .filter((entry): entry is string => Boolean(entry))
            .join(OS.platform() === "win32" ? ";" : ":"),
        }
      : process.env;
    const prepared = prepareWindowsSafeProcess(commandInput.command, commandInput.args, {
      env: updateEnv,
    });
    const child = yield* input.spawner.spawn(
      ChildProcess.make(prepared.command, prepared.args, {
        shell: prepared.shell,
        ...(prepared.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
        env: updateEnv,
      }),
    );
    yield* Effect.addFinalizer(() => child.kill().pipe(Effect.ignore));
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectUint8StreamText({ stream: child.stdout, maxBytes: UPDATE_OUTPUT_MAX_BYTES }),
        collectUint8StreamText({ stream: child.stderr, maxBytes: UPDATE_OUTPUT_MAX_BYTES }),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );
    return {
      stdout: stdout.text,
      stderr: stderr.text,
      exitCode,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
    };
  });

  return Effect.fn("ProviderHealth.updateProvider")(function* (updateInput) {
    const provider = updateInput.provider;
    const toUpdateError = (reason: unknown) =>
      new ServerProviderUpdateError({
        provider,
        reason: reason instanceof Error ? reason.message : String(reason),
      });
    const settings = yield* input.serverSettings.getSettings.pipe(Effect.mapError(toUpdateError));
    if (!isProviderEnabledForSettings(provider, settings)) {
      return yield* new ServerProviderUpdateError({
        provider,
        reason: "Provider is disabled in Agent Group settings.",
      });
    }
    const capabilities = yield* input
      .getProviderMaintenanceCapabilities(provider)
      .pipe(Effect.mapError(toUpdateError));
    const update = capabilities.update;
    if (!update) {
      return yield* new ServerProviderUpdateError({
        provider,
        reason: "This provider does not support one-click updates.",
      });
    }

    const run = Effect.gen(function* () {
      const startedAt = yield* nowIso;
      yield* input.setProviderUpdateState(
        provider,
        makeUpdateState({
          status: "running",
          startedAt,
          finishedAt: null,
          message: "Updating provider.",
        }),
      );
      const commandResult = yield* runUpdateCommand({
        command: update.executable,
        args: update.args,
        ...(update.pathPrepend ? { pathPrepend: update.pathPrepend } : {}),
      }).pipe(
        Effect.scoped,
        Effect.timeoutOption(Duration.millis(providerUpdateTimeoutMs)),
        Effect.result,
      );
      const finishedAt = yield* nowIso;
      if (Result.isFailure(commandResult)) {
        const providers = yield* input.setProviderUpdateState(
          provider,
          makeUpdateState({
            status: "failed",
            startedAt,
            finishedAt,
            message: describeUpdateCommandError(commandResult.failure),
          }),
        );
        return { providers };
      }
      const result = commandResult.success;
      const output = Option.isSome(result)
        ? [result.value.stderr, result.value.stdout].filter(Boolean).join("\n\n").trim() || null
        : null;
      const failed = Option.isNone(result) || result.value.exitCode !== 0;
      if (failed) {
        const message = Option.isNone(result)
          ? `Update timed out after ${formatProviderUpdateTimeout(providerUpdateTimeoutMs)}. The provider process was stopped.`
          : `Update command exited with code ${result.value.exitCode}.`;
        const providers = yield* input.setProviderUpdateState(
          provider,
          makeUpdateState({
            status: "failed",
            startedAt,
            finishedAt,
            message,
            output: output ? output.slice(0, UPDATE_OUTPUT_MAX_BYTES) : null,
          }),
        );
        return { providers };
      }

      const providers = yield* input.refreshNow.pipe(Effect.mapError(toUpdateError));
      const refreshed = providers.find((status) => status.provider === provider);
      const stillOutdated = refreshed?.versionAdvisory?.status === "behind_latest";
      const finalProviders = yield* input.setProviderUpdateState(
        provider,
        makeUpdateState({
          status: stillOutdated ? "unchanged" : "succeeded",
          startedAt,
          finishedAt,
          message: stillOutdated
            ? "Update command completed, but Agent Group still detects an outdated provider version."
            : "Provider updated.",
          output: output ? output.slice(0, UPDATE_OUTPUT_MAX_BYTES) : null,
        }),
      );
      return { providers: finalProviders };
    });

    return yield* input.commandCoordinator.withCommandLock({
      targetKey: provider,
      lockKey: update.lockKey,
      onQueued: input
        .setProviderUpdateState(
          provider,
          makeUpdateState({
            status: "queued",
            startedAt: null,
            finishedAt: null,
            message: "Waiting for another provider update to finish.",
          }),
        )
        .pipe(Effect.asVoid),
      run,
    });
  });
}
