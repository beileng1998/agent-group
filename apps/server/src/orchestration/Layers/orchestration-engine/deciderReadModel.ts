import type {
  OrchestrationCommand,
  OrchestrationReadModel,
  ThreadId,
} from "@agent-group/contracts";
import { ORCHESTRATION_WS_METHODS } from "@agent-group/contracts";
import { Cause, Effect, Option } from "effect";

import {
  OrchestrationCommandInternalError,
  type OrchestrationDispatchError,
} from "../../Errors.ts";
import type { ProjectionSnapshotQueryShape } from "../../Services/ProjectionSnapshotQuery.ts";
import type { CommandReadModelState } from "./commandRuntime.ts";

const overlayThread = (
  model: OrchestrationReadModel,
  thread: OrchestrationReadModel["threads"][number],
): OrchestrationReadModel => {
  const existingThread = model.threads.find((entry) => entry.id === thread.id);
  const mergedThread =
    existingThread && existingThread.messages.length > 0
      ? { ...thread, messages: existingThread.messages }
      : thread;
  return {
    ...model,
    threads:
      existingThread === undefined
        ? [...model.threads, mergedThread]
        : model.threads.map((entry) => (entry.id === thread.id ? mergedThread : entry)),
  };
};

export const makeDeciderReadModel = (input: {
  readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
  readonly commandReadModel: CommandReadModelState;
}) => {
  const loadThreadDetail = (
    command: OrchestrationCommand,
    model: OrchestrationReadModel,
    threadId: ThreadId,
  ): Effect.Effect<OrchestrationReadModel, OrchestrationDispatchError> =>
    input.projectionSnapshotQuery.getThreadDetailById(threadId).pipe(
      Effect.map((threadOption) =>
        Option.match(threadOption, {
          onNone: () => model,
          onSome: (thread) => overlayThread(model, thread),
        }),
      ),
      Effect.mapError(
        (error) =>
          new OrchestrationCommandInternalError({
            commandId: command.commandId,
            commandType: command.type,
            detail: `Failed to load thread detail for command validation: ${error.message}`,
          }),
      ),
    );

  const build = (
    command: OrchestrationCommand,
  ): Effect.Effect<OrchestrationReadModel, OrchestrationDispatchError> => {
    const model = input.commandReadModel.get();
    switch (command.type) {
      case "thread.handoff.create":
      case "thread.fork.create":
        return loadThreadDetail(command, model, command.sourceThreadId);
      case "thread.turn.start":
        return command.sourceProposedPlan
          ? loadThreadDetail(command, model, command.sourceProposedPlan.threadId)
          : Effect.succeed(model);
      case "thread.conversation.rollback":
      case "thread.message.edit-and-resend":
      case "thread.message.assistant.complete":
      case "thread.marker.add":
        return loadThreadDetail(command, model, command.threadId);
      default:
        return Effect.succeed(model);
    }
  };

  const refresh = Effect.gen(function* () {
    const model = yield* input.projectionSnapshotQuery.getCommandReadModel();
    input.commandReadModel.set(model);
    return model;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("failed to refresh orchestration command read model").pipe(
        Effect.annotateLogs({ cause: Cause.pretty(cause) }),
        Effect.flatMap(() =>
          Effect.fail(
            new OrchestrationCommandInternalError({
              commandId: "repair-local-state",
              commandType: ORCHESTRATION_WS_METHODS.repairState,
              detail:
                "Projection state changed, but the refreshed command snapshot could not be loaded.",
            }),
          ),
        ),
      ),
    ),
  );

  return { build, refresh } as const;
};
