// FILE: workspaceSupport.ts
// Purpose: Canonicalize and prepare project workspaces for transport adapters.
// Layer: Server workspace support

import { Data, Effect, FileSystem, Path } from "effect";

import { ServerConfig } from "../config";
import { realpathNearestExisting } from "../realpathNearestExisting";
import {
  ensureStudioWorkspaceInstructionsFiles,
  STUDIO_WORKSPACE_SUBDIRECTORIES,
} from "../studioWorkspaceScaffold";

const CHAT_WORKSPACE_SUBDIRECTORIES = ["work", "outputs"] as const;

export class WorkspaceSupportError extends Data.TaggedError("WorkspaceSupportError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export function makeWorkspaceSupport(dependencies: {
  readonly config: typeof ServerConfig.Service;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
}) {
  const { config, fileSystem, path } = dependencies;

  const canonicalizeProjectWorkspaceRoot = Effect.fnUntraced(function* (
    workspaceRoot: string,
    options: { readonly createIfMissing?: boolean } = {},
  ) {
    const rawWorkspaceRoot = workspaceRoot.trim();
    const expandedWorkspaceRoot =
      rawWorkspaceRoot === "~"
        ? config.homeDir
        : rawWorkspaceRoot.startsWith("~/") || rawWorkspaceRoot.startsWith("~\\")
          ? path.join(config.homeDir, rawWorkspaceRoot.slice(2))
          : rawWorkspaceRoot;
    const normalizedWorkspaceRoot = path.resolve(expandedWorkspaceRoot);
    let workspaceStat = yield* fileSystem
      .stat(normalizedWorkspaceRoot)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!workspaceStat) {
      if (!options.createIfMissing) {
        return yield* new WorkspaceSupportError({
          message: `Project directory does not exist: ${normalizedWorkspaceRoot}`,
        });
      }
      yield* fileSystem.makeDirectory(normalizedWorkspaceRoot, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceSupportError({
              message: `Failed to create project directory: ${normalizedWorkspaceRoot}`,
              cause,
            }),
        ),
      );
      workspaceStat = yield* fileSystem
        .stat(normalizedWorkspaceRoot)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (!workspaceStat) {
        return yield* new WorkspaceSupportError({
          message: `Failed to create project directory: ${normalizedWorkspaceRoot}`,
        });
      }
    }
    if (workspaceStat.type !== "Directory") {
      return yield* new WorkspaceSupportError({
        message: `Project path is not a directory: ${normalizedWorkspaceRoot}`,
      });
    }
    return yield* realpathNearestExisting(normalizedWorkspaceRoot).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
  });

  const prepareWorkspaceSubdirectories = Effect.fnUntraced(function* (
    workspaceRoot: string,
    relativeDirnames: readonly string[],
  ) {
    for (const dirname of relativeDirnames) {
      const childPath = path.join(workspaceRoot, dirname);
      yield* fileSystem.makeDirectory(childPath, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceSupportError({
              message: `Failed to create workspace directory: ${childPath}`,
              cause,
            }),
        ),
      );
    }
  });

  const prepareChatWorkspaceRoot = (workspaceRoot: string) =>
    prepareWorkspaceSubdirectories(workspaceRoot, CHAT_WORKSPACE_SUBDIRECTORIES);

  const prepareStudioWorkspaceRoot = (workspaceRoot: string) =>
    prepareWorkspaceSubdirectories(workspaceRoot, STUDIO_WORKSPACE_SUBDIRECTORIES).pipe(
      Effect.andThen(
        ensureStudioWorkspaceInstructionsFiles(workspaceRoot).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("failed to write studio workspace instructions", {
              workspaceRoot,
              cause,
            }),
          ),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      ),
    );

  return {
    canonicalizeProjectWorkspaceRoot,
    prepareChatWorkspaceRoot,
    prepareStudioWorkspaceRoot,
  };
}

export type WorkspaceSupport = ReturnType<typeof makeWorkspaceSupport>;
