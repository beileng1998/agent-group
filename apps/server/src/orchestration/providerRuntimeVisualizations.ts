// FILE: providerRuntimeVisualizations.ts
// Purpose: Capture Codex visualization fragments at assistant-message completion.
// Layer: Server orchestration provider projection

import type {
  MessageId,
  OrchestrationProjectShell,
  OrchestrationThread,
  ProviderRuntimeEvent,
} from "@agent-group/contracts";
import { Cause, Effect } from "effect";

import { captureCodexInlineVisualizations } from "../codexVisualizations.ts";
import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils.ts";

export function makeProviderRuntimeVisualizations(input: {
  readonly stateDir: string;
  readonly getProjectShell: (
    thread: Pick<OrchestrationThread, "projectId">,
  ) => Effect.Effect<OrchestrationProjectShell | undefined>;
}) {
  const captureAssistantMessage = (params: {
    readonly event: ProviderRuntimeEvent;
    readonly thread: OrchestrationThread;
    readonly messageId: MessageId;
  }) => {
    if (
      params.event.provider !== "codex" ||
      params.event.type !== "item.completed" ||
      params.event.payload.itemType !== "assistant_message" ||
      !params.event.payload.detail
    ) {
      return Effect.void;
    }

    return Effect.gen(function* () {
      const project = yield* input.getProjectShell(params.thread);
      if (!project) return;
      const workspaceRoot = resolveThreadWorkspaceCwd({
        thread: params.thread,
        projects: [project],
      });
      if (!workspaceRoot) return;
      yield* Effect.promise(() =>
        captureCodexInlineVisualizations({
          stateDir: input.stateDir,
          workspaceRoot,
          threadId: params.thread.id,
          ...(params.event.providerRefs?.providerThreadId
            ? { providerThreadId: params.event.providerRefs.providerThreadId }
            : {}),
          messageId: params.messageId,
          createdAt: params.event.createdAt,
          text: params.event.payload.detail!,
        }),
      );
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logDebug("failed to capture Codex inline visualization", {
              threadId: params.thread.id,
              messageId: params.messageId,
              cause: Cause.pretty(cause),
            }),
      ),
    );
  };

  return { captureAssistantMessage };
}
