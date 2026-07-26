import { type ServerSettings, TerminalAgentProvider, type ThreadId } from "@agent-group/contracts";
import { Effect, Schema } from "effect";

import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine";
import { TerminalAgentServiceError } from "./Services/TerminalAgentService";
import type {
  ManagedTerminalModelSelection,
  ResolvedTerminalTarget,
} from "./terminalAgentRuntimeTypes";
import { managedTerminalPlatformSupported } from "./terminalAgentServiceErrors";

const failure = (reason: TerminalAgentServiceError["reason"], message: string) =>
  new TerminalAgentServiceError({ reason, message });

export function resolveTerminalTarget(input: {
  readonly engine: OrchestrationEngineShape;
  readonly settings: ServerSettings;
  readonly threadId: ThreadId;
  readonly allowDisabled?: boolean;
  readonly platform?: NodeJS.Platform;
}): Effect.Effect<ResolvedTerminalTarget, TerminalAgentServiceError> {
  return input.engine.getReadModel().pipe(
    Effect.flatMap((readModel) => {
      if (!input.allowDisabled && !managedTerminalPlatformSupported(input.platform)) {
        return Effect.fail(
          failure("unsupported-provider", "Managed Agent Terminal is unavailable on Windows."),
        );
      }
      const thread = readModel.threads.find((entry) => entry.id === input.threadId);
      if (!thread || thread.deletedAt !== null) {
        return Effect.fail(failure("thread-not-found", `Thread ${input.threadId} was not found.`));
      }
      const project = readModel.projects.find((entry) => entry.id === thread.projectId);
      if (!project || project.deletedAt !== null) {
        return Effect.fail(
          failure("thread-not-found", `Project ${thread.projectId} was not found.`),
        );
      }
      const modelSelection = thread.modelSelection;
      if (
        !Schema.is(TerminalAgentProvider)(modelSelection.provider) ||
        (!input.allowDisabled && !input.settings.providers[modelSelection.provider].enabled)
      ) {
        return Effect.fail(
          failure(
            "unsupported-provider",
            `Provider ${modelSelection.provider} does not support managed Terminal.`,
          ),
        );
      }
      return Effect.succeed({
        threadId: thread.id,
        provider: modelSelection.provider,
        modelSelection: modelSelection as ManagedTerminalModelSelection,
        runtimeMode: thread.runtimeMode,
        workspaceRoot: project.workspaceRoot,
        coordinates: {
          workspaceRoot: project.workspaceRoot,
          groupId: project.id,
          sessionId: thread.id,
          ...(thread.parentThreadId !== undefined
            ? { parentSessionId: thread.parentThreadId }
            : {}),
          createdAt: thread.createdAt,
        },
      });
    }),
  );
}
