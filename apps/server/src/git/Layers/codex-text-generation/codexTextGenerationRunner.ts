import { Effect, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { DEFAULT_GIT_TEXT_GENERATION_MODEL } from "@agent-group/contracts";
import { prepareWindowsSafeProcess } from "@agent-group/shared/windowsProcess";

import { buildCodexProcessEnv } from "../../../codexProcessEnv.ts";
import { TextGenerationError } from "../../Errors.ts";
import type {
  BranchNameGenerationInput,
  TextGenerationOperation,
} from "../../Services/TextGeneration.ts";
import { toJsonSchemaObject } from "../../textGenerationShared.ts";
import {
  makeCodexTextGenerationFiles,
  type MaterializedImageAttachments,
} from "./codexTextGenerationFiles.ts";
import {
  CODEX_REASONING_EFFORT,
  CODEX_TIMEOUT_MS,
  normalizeCodexError,
  resolveCodexBinaryPath,
  resolveCodexHomePath,
  resolveCodexModel,
} from "./codexTextGenerationValues.ts";

export type RunCodexJson = <S extends Schema.Top>(input: {
  operation: TextGenerationOperation;
  cwd: string;
  prompt: string;
  outputSchemaJson: S;
  imagePaths?: ReadonlyArray<string>;
  cleanupPaths?: ReadonlyArray<string>;
  codexHomePath?: string;
  model?: string;
  modelSelection?: BranchNameGenerationInput["modelSelection"];
  providerOptions?: BranchNameGenerationInput["providerOptions"];
}) => Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]>;

export type CodexTextGenerationRuntime = {
  readonly runCodexJson: RunCodexJson;
  readonly materializeImageAttachments: (
    operation: TextGenerationOperation,
    attachments: BranchNameGenerationInput["attachments"],
  ) => Effect.Effect<MaterializedImageAttachments, TextGenerationError>;
};

export const makeCodexTextGenerationRuntime = Effect.gen(function* () {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const files = yield* makeCodexTextGenerationFiles;

  const readStreamAsString = <E>(
    operation: string,
    stream: Stream.Stream<Uint8Array, E>,
  ): Effect.Effect<string, TextGenerationError> =>
    Effect.gen(function* () {
      let text = "";
      yield* Stream.runForEach(stream, (chunk) =>
        Effect.sync(() => {
          text += Buffer.from(chunk).toString("utf8");
        }),
      ).pipe(
        Effect.mapError((cause) =>
          normalizeCodexError("codex", operation, cause, "Failed to collect process output"),
        ),
      );
      return text;
    });

  const runCodexJson: RunCodexJson = ({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    imagePaths = [],
    cleanupPaths = [],
    codexHomePath,
    model,
    modelSelection,
    providerOptions,
  }) =>
    Effect.gen(function* () {
      const codexBinaryPath = resolveCodexBinaryPath(providerOptions);
      const resolvedCodexHomePath = resolveCodexHomePath(codexHomePath, providerOptions);
      const schemaPath = yield* files.writeTempFile(
        operation,
        "codex-schema",
        JSON.stringify(toJsonSchemaObject(outputSchemaJson)),
      );
      const outputPath = yield* files.writeTempFile(operation, "codex-output", "");
      const isolatedCodexHome = yield* files.prepareIsolatedCodexHome(
        operation,
        resolvedCodexHomePath,
      );

      const runCodexCommand = Effect.gen(function* () {
        const env = buildCodexProcessEnv({ homePath: isolatedCodexHome.homePath });
        const args = [
          "exec",
          "--ephemeral",
          "--skip-git-repo-check",
          "--config",
          'approval_policy="never"',
          "-s",
          "read-only",
          "--model",
          resolveCodexModel(model, modelSelection) ?? DEFAULT_GIT_TEXT_GENERATION_MODEL,
          "--config",
          `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
          "--output-schema",
          schemaPath,
          "--output-last-message",
          outputPath,
          ...imagePaths.flatMap((imagePath) => ["--image", imagePath]),
          "-",
        ];
        const prepared = prepareWindowsSafeProcess(codexBinaryPath, args, { cwd, env });
        const command = ChildProcess.make(prepared.command, prepared.args, {
          cwd,
          env,
          shell: prepared.shell,
          ...(prepared.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
          stdin: {
            stream: Stream.make(new TextEncoder().encode(prompt)),
          },
        });

        const child = yield* commandSpawner
          .spawn(command)
          .pipe(
            Effect.mapError((cause) =>
              normalizeCodexError(
                codexBinaryPath,
                operation,
                cause,
                "Failed to spawn Codex CLI process",
              ),
            ),
          );

        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            readStreamAsString(operation, child.stdout),
            readStreamAsString(operation, child.stderr),
            child.exitCode.pipe(
              Effect.map((value) => Number(value)),
              Effect.mapError((cause) =>
                normalizeCodexError(
                  codexBinaryPath,
                  operation,
                  cause,
                  "Failed to read Codex CLI exit code",
                ),
              ),
            ),
          ],
          { concurrency: "unbounded" },
        );

        if (exitCode !== 0) {
          const stderrDetail = stderr.trim();
          const stdoutDetail = stdout.trim();
          const detail = stderrDetail.length > 0 ? stderrDetail : stdoutDetail;
          return yield* new TextGenerationError({
            operation,
            detail:
              detail.length > 0
                ? `Codex CLI command failed: ${detail}`
                : `Codex CLI command failed with code ${exitCode}.`,
          });
        }
      });

      const cleanup = Effect.all(
        [
          files.safeUnlink(schemaPath),
          files.safeUnlink(outputPath),
          files.safeRemoveDirectory(isolatedCodexHome.homePath),
          ...cleanupPaths.map((filePath) => files.safeUnlink(filePath)),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.asVoid);

      return yield* Effect.gen(function* () {
        yield* runCodexCommand.pipe(
          Effect.scoped,
          Effect.timeoutOption(CODEX_TIMEOUT_MS),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new TextGenerationError({
                    operation,
                    detail: "Codex CLI request timed out.",
                  }),
                ),
              onSome: () => Effect.void,
            }),
          ),
        );

        return yield* files.fileSystem.readFileString(outputPath).pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation,
                detail: "Failed to read Codex output file.",
                cause,
              }),
          ),
          Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson))),
          Effect.catchTag("SchemaError", (cause) =>
            Effect.fail(
              new TextGenerationError({
                operation,
                detail: "Codex returned invalid structured output.",
                cause,
              }),
            ),
          ),
        );
      }).pipe(Effect.ensuring(cleanup));
    });

  return {
    runCodexJson,
    materializeImageAttachments: files.materializeImageAttachments,
  } satisfies CodexTextGenerationRuntime;
});
