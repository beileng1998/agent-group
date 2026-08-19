import type { OrchestrationCommand, OrchestrationReadModel } from "@agent-group/contracts";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "../Errors.ts";
import { requireThread } from "../commandInvariants.ts";
import { type DeciderResult, withEventBase } from "./common.ts";

type ThreadGoalCommand = Extract<OrchestrationCommand, { type: "thread.goal.continue" }>;

export const decideThreadGoalCommand = Effect.fn("decideThreadGoalCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: ThreadGoalCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<DeciderResult, OrchestrationCommandInvariantError> {
  yield* requireThread({ readModel, command, threadId: command.threadId });
  return {
    ...withEventBase({
      aggregateKind: "thread",
      aggregateId: command.threadId,
      occurredAt: command.createdAt,
      commandId: command.commandId,
    }),
    type: "thread.goal-continuation-requested",
    payload: {
      threadId: command.threadId,
      goalStartedAt: command.goalStartedAt,
      trigger: command.trigger,
      ...(command.sourceTurnId !== undefined ? { sourceTurnId: command.sourceTurnId } : {}),
      createdAt: command.createdAt,
    },
  };
});
