import type {
  ProviderComposerCapabilities,
  ProviderListModelsResult,
  ProviderListSkillsResult,
} from "@agent-group/contracts";
import { prepareWindowsSafeProcess } from "@agent-group/shared/windowsProcess";
import { Effect, Option, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/unstable/process";

import {
  buildCursorCliModelListCommand,
  fetchCursorAcpModelDescriptors,
  makeCursorAcpRuntime,
  parseCursorCliModelList,
  type CursorAcpRuntimeCursorSettings,
} from "./acp/CursorAcpSupport.ts";
import {
  buildCursorAgentHeadlessEnv,
  resolveCursorAgentBinaryPath,
} from "./acp/CursorAcpCommand.ts";
import { discoverCursorSkills } from "./cursorSkillsDiscovery.ts";
import { ProviderAdapterRequestError } from "./Errors.ts";
import type { CursorAdapterShape } from "./Services/CursorAdapter.ts";

const PROVIDER = "cursor" as const;
const CURSOR_MODEL_DISCOVERY_TIMEOUT_MS = 15_000;

const collectStreamAsString = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  Stream.runFold(
    stream,
    () => "",
    (acc, chunk) => acc + new TextDecoder().decode(chunk),
  );

export function makeCursorAdapterDiscovery(input: {
  readonly cursorSettings: CursorAcpRuntimeCursorSettings;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly homeDir: string;
}): Required<Pick<CursorAdapterShape, "getComposerCapabilities" | "listSkills" | "listModels">> {
  const getComposerCapabilities: NonNullable<CursorAdapterShape["getComposerCapabilities"]> = () =>
    Effect.succeed({
      provider: PROVIDER,
      supportsSkillMentions: true,
      supportsSkillDiscovery: true,
      supportsNativeSlashCommandDiscovery: false,
      supportsPluginMentions: false,
      supportsPluginDiscovery: false,
      supportsRuntimeModelList: true,
      supportsThreadCompaction: false,
      supportsThreadImport: true,
    } satisfies ProviderComposerCapabilities);

  const listSkills: NonNullable<CursorAdapterShape["listSkills"]> = (request) =>
    Effect.tryPromise({
      try: async () =>
        ({
          skills: await discoverCursorSkills({ cwd: request.cwd, homeDir: input.homeDir }),
          source: "cursor.filesystem",
          cached: false,
        }) satisfies ProviderListSkillsResult,
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "skill/list",
          detail: "Failed to discover Cursor skills.",
          cause,
        }),
    });

  const listModels: NonNullable<CursorAdapterShape["listModels"]> = (request) => {
    const binaryPath = request.binaryPath?.trim();
    const apiEndpoint = request.apiEndpoint?.trim();
    const effectiveBinaryPath = resolveCursorAgentBinaryPath(
      binaryPath || input.cursorSettings.binaryPath,
    );
    const effectiveApiEndpoint = apiEndpoint || input.cursorSettings.apiEndpoint;
    const runCursorModelListCommand = Effect.gen(function* () {
      const command = buildCursorCliModelListCommand({
        binaryPath: effectiveBinaryPath,
        ...(effectiveApiEndpoint ? { apiEndpoint: effectiveApiEndpoint } : {}),
      });
      const env = buildCursorAgentHeadlessEnv();
      const prepared = prepareWindowsSafeProcess(command.command, command.args, { env });
      const child = yield* input.childProcessSpawner.spawn(
        ChildProcess.make(prepared.command, prepared.args, {
          shell: prepared.shell,
          ...(prepared.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
          env,
        }),
      );
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          collectStreamAsString(child.stdout),
          collectStreamAsString(child.stderr),
          child.exitCode.pipe(Effect.map(Number)),
        ],
        { concurrency: "unbounded" },
      );
      if (exitCode !== 0) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "model/list",
          detail:
            stderr.trim() ||
            `Cursor model discovery failed because '${[command.command, ...command.args].join(" ")}' exited with code ${exitCode}.`,
        });
      }
      const models = parseCursorCliModelList(stdout);
      if (models.length === 0) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "model/list",
          detail: "Cursor model discovery returned no CLI models.",
        });
      }
      return models;
    }).pipe(
      Effect.scoped,
      Effect.timeoutOption(CURSOR_MODEL_DISCOVERY_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "model/list",
                detail: "Timed out while discovering Cursor models via CLI.",
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

    const effectiveAcpSettings: CursorAcpRuntimeCursorSettings = {
      binaryPath: effectiveBinaryPath,
      ...(effectiveApiEndpoint ? { apiEndpoint: effectiveApiEndpoint } : {}),
    };
    const runCursorAcpModelDiscovery = Effect.gen(function* () {
      const runtime = yield* makeCursorAcpRuntime({
        cursorSettings: effectiveAcpSettings,
        childProcessSpawner: input.childProcessSpawner,
        cwd: process.cwd(),
        clientInfo: { name: "Agent Group", version: "0.0.0" },
      });
      const started = yield* runtime.start();
      const models = yield* fetchCursorAcpModelDescriptors(runtime, started.sessionId);
      if (models.length === 0) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "model/list",
          detail: "Cursor ACP model discovery returned no models.",
        });
      }
      return models;
    }).pipe(
      Effect.scoped,
      Effect.timeoutOption(CURSOR_MODEL_DISCOVERY_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "model/list",
                detail: "Timed out while discovering Cursor models via ACP.",
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

    return runCursorAcpModelDiscovery.pipe(
      Effect.map((models) => ({ models, source: "cursor.acp", cached: false })),
      Effect.catch(() =>
        runCursorModelListCommand.pipe(
          Effect.map(
            (models) =>
              ({ models, source: "cursor.cli", cached: false }) satisfies ProviderListModelsResult,
          ),
        ),
      ),
      Effect.mapError((cause) =>
        cause instanceof ProviderAdapterRequestError
          ? cause
          : new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "model/list",
              detail: "Failed to discover Cursor models.",
              cause,
            }),
      ),
    );
  };

  return { getComposerCapabilities, listSkills, listModels };
}
