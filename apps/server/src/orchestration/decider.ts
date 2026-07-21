import type { OrchestrationCommand, OrchestrationReadModel } from "@agent-group/contracts";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import { type DeciderResult } from "./decider/common.ts";
import { decideMessageProjectionCommand } from "./decider/messageProjectionCommands.ts";
import { decideProjectCommand } from "./decider/projectCommands.ts";
import { decideThreadAnnotationCommand } from "./decider/threadAnnotationCommands.ts";
import { decideThreadCreationCommand } from "./decider/threadCreationCommands.ts";
import { decideThreadHistoryCommand } from "./decider/threadHistoryCommands.ts";
import { decideThreadLifecycleCommand } from "./decider/threadLifecycleCommands.ts";
import { decideTurnCommand } from "./decider/turnCommands.ts";

export const decideOrchestrationCommand = Effect.fn("decideOrchestrationCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<DeciderResult, OrchestrationCommandInvariantError> {
  switch (command.type) {
    case "project.create":
    case "project.meta.update":
    case "project.delete":
      return yield* decideProjectCommand({ command, readModel });

    case "thread.create":
    case "thread.handoff.create":
    case "thread.fork.create":
    case "thread.sidechat.promote":
      return yield* decideThreadCreationCommand({ command, readModel });

    case "thread.delete":
    case "thread.archive":
    case "thread.unarchive":
    case "thread.meta.update":
    case "thread.runtime-mode.set":
    case "thread.interaction-mode.set":
      return yield* decideThreadLifecycleCommand({ command, readModel });

    case "thread.pinned-message.add":
    case "thread.pinned-message.remove":
    case "thread.pinned-message.done.set":
    case "thread.pinned-message.label.set":
    case "thread.marker.add":
    case "thread.marker.remove":
    case "thread.marker.done.set":
    case "thread.marker.label.set":
    case "thread.marker.color.set":
    case "thread.marker.note.set":
      return yield* decideThreadAnnotationCommand({ command, readModel });

    case "thread.turn.start":
    case "thread.turn.dispatch-queued":
    case "thread.turn.interrupt":
    case "thread.approval.respond":
    case "thread.user-input.respond":
      return yield* decideTurnCommand({ command, readModel });

    case "thread.checkpoint.revert":
    case "thread.conversation.rollback":
    case "thread.message.edit-and-resend":
    case "thread.session.stop":
    case "thread.session.set":
    case "thread.messages.import":
      return yield* decideThreadHistoryCommand({ command, readModel });

    case "thread.message.assistant.delta":
    case "thread.message.assistant.complete":
    case "thread.proposed-plan.upsert":
    case "thread.turn.diff.complete":
    case "thread.revert.complete":
    case "thread.conversation.rollback.complete":
    case "thread.activity.append":
      return yield* decideMessageProjectionCommand({ command, readModel });

    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown command type: ${fallback.type}`,
      });
    }
  }
});
