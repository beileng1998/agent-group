import type { ClientOrchestrationCommand } from "@agent-group/contracts";
import type { FileSystem, Path } from "effect";
import { Effect } from "effect";

import type { ServerConfig } from "../config";
import type { ServerRuntimeStartup } from "../serverRuntimeStartup";
import type { WorkspaceSupport } from "../workspace/workspaceSupport";
import { makeDispatchCommandNormalizer } from "./dispatchCommandNormalization";
import type { OrchestrationEngineService } from "./Services/OrchestrationEngine";

export function makeOrchestrationCommandDispatcher(dependencies: {
  readonly config: typeof ServerConfig.Service;
  readonly fileSystem: FileSystem.FileSystem;
  readonly orchestrationEngine: typeof OrchestrationEngineService.Service;
  readonly path: Path.Path;
  readonly runtimeStartup: typeof ServerRuntimeStartup.Service;
  readonly workspaceSupport: WorkspaceSupport;
}) {
  const normalize = makeDispatchCommandNormalizer({
    attachmentsDir: dependencies.config.attachmentsDir,
    chatWorkspaceRoot: dependencies.config.chatWorkspaceRoot,
    studioWorkspaceRoot: dependencies.config.studioWorkspaceRoot,
    fileSystem: dependencies.fileSystem,
    path: dependencies.path,
    canonicalizeProjectWorkspaceRoot:
      dependencies.workspaceSupport.canonicalizeProjectWorkspaceRoot,
    prepareChatWorkspaceRoot: dependencies.workspaceSupport.prepareChatWorkspaceRoot,
    prepareStudioWorkspaceRoot: dependencies.workspaceSupport.prepareStudioWorkspaceRoot,
  });

  return (command: ClientOrchestrationCommand) =>
    Effect.gen(function* () {
      const { command: normalizedCommand, prepareWorkspaceRoot } = yield* normalize({ command });
      const result = yield* dependencies.runtimeStartup.enqueueCommand(
        dependencies.orchestrationEngine.dispatch(normalizedCommand),
      );
      if (prepareWorkspaceRoot) yield* prepareWorkspaceRoot;
      return result;
    });
}
