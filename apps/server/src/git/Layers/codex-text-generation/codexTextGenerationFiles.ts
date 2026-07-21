import { randomUUID } from "node:crypto";

import { Effect, FileSystem, Path } from "effect";

import { resolveCodexHome } from "@agent-group/shared/codexConfig";

import { resolveAttachmentPath } from "../../../attachmentStore.ts";
import { ServerConfig } from "../../../config.ts";
import { TextGenerationError } from "../../Errors.ts";
import type {
  BranchNameGenerationInput,
  TextGenerationOperation,
} from "../../Services/TextGeneration.ts";
import { sanitizeCodexConfigForTextGeneration } from "./codexTextGenerationValues.ts";

export type MaterializedImageAttachments = {
  readonly imagePaths: ReadonlyArray<string>;
};

export const makeCodexTextGenerationFiles = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* Effect.service(ServerConfig);
  const tempDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "/tmp";

  const writeTempFile = (
    operation: string,
    prefix: string,
    content: string,
  ): Effect.Effect<string, TextGenerationError> => {
    const filePath = path.join(tempDir, `agent-group-${prefix}-${process.pid}-${randomUUID()}.tmp`);
    return fileSystem.writeFileString(filePath, content).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail: `Failed to write temp file at ${filePath}.`,
            cause,
          }),
      ),
      Effect.as(filePath),
    );
  };

  const safeUnlink = (filePath: string): Effect.Effect<void, never> =>
    fileSystem.remove(filePath).pipe(Effect.catch(() => Effect.void));

  const safeRemoveDirectory = (directoryPath: string): Effect.Effect<void, never> =>
    fileSystem.remove(directoryPath, { recursive: true }).pipe(Effect.catch(() => Effect.void));

  const prepareIsolatedCodexHome = (
    operation: TextGenerationOperation,
    sourceHomePath?: string,
  ): Effect.Effect<{ readonly homePath: string }, TextGenerationError> =>
    Effect.gen(function* () {
      const sourceCodexHome = sourceHomePath?.trim() || resolveCodexHome(process.env);
      const isolatedHomePath = path.join(
        tempDir,
        `agent-group-codex-home-${process.pid}-${randomUUID()}`,
      );

      yield* fileSystem.makeDirectory(isolatedHomePath, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation,
              detail: `Failed to create isolated Codex home at ${isolatedHomePath}.`,
              cause,
            }),
        ),
      );

      const sourceConfig = yield* fileSystem
        .readFileString(path.join(sourceCodexHome, "config.toml"))
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (sourceConfig !== null) {
        yield* fileSystem
          .writeFileString(
            path.join(isolatedHomePath, "config.toml"),
            sanitizeCodexConfigForTextGeneration(sourceConfig),
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new TextGenerationError({
                  operation,
                  detail: "Failed to copy Codex config for isolated text generation.",
                  cause,
                }),
            ),
          );
      }

      const sourceAuth = yield* fileSystem
        .readFileString(path.join(sourceCodexHome, "auth.json"))
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (sourceAuth !== null) {
        yield* fileSystem
          .writeFileString(path.join(isolatedHomePath, "auth.json"), sourceAuth)
          .pipe(
            Effect.mapError(
              (cause) =>
                new TextGenerationError({
                  operation,
                  detail: "Failed to copy Codex auth for isolated text generation.",
                  cause,
                }),
            ),
          );
      }

      return { homePath: isolatedHomePath };
    });

  const materializeImageAttachments = (
    _operation: TextGenerationOperation,
    attachments: BranchNameGenerationInput["attachments"],
  ): Effect.Effect<MaterializedImageAttachments, TextGenerationError> =>
    Effect.gen(function* () {
      if (!attachments || attachments.length === 0) {
        return { imagePaths: [] };
      }

      const imagePaths: string[] = [];
      for (const attachment of attachments) {
        if (attachment.type !== "image") {
          continue;
        }

        const resolvedPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        if (!resolvedPath || !path.isAbsolute(resolvedPath)) {
          continue;
        }
        const fileInfo = yield* fileSystem
          .stat(resolvedPath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!fileInfo || fileInfo.type !== "File") {
          continue;
        }
        imagePaths.push(resolvedPath);
      }
      return { imagePaths };
    });

  return {
    fileSystem,
    writeTempFile,
    safeUnlink,
    safeRemoveDirectory,
    prepareIsolatedCodexHome,
    materializeImageAttachments,
  };
});
