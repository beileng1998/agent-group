import { CommandId } from "@agent-group/contracts";
import {
  formatTemporarySidechatTitle,
  isTemporarySidechatThread,
  stripTemporarySidechatTitlePrefix,
} from "@agent-group/shared/agentGroupSessions";
import {
  buildPromptThreadTitleFallback,
  isGenericChatThreadTitle,
} from "@agent-group/shared/chatThreads";
import { isGenericTerminalThreadTitle } from "@agent-group/shared/terminalThreads";
import { Cause, Effect, Layer, Option } from "effect";

import { TextGeneration } from "../../git/Services/TextGeneration.ts";
import type { ThreadTitleGenerationInput } from "../../git/Services/TextGeneration.ts";
import { resolveTextGenerationInputForSelection } from "../../git/textGenerationSelection.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  FirstTurnThreadTitle,
  type FirstTurnThreadTitleShape,
} from "../Services/FirstTurnThreadTitle.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { attachmentTitleSeed } from "./providerTurnPrompt.ts";

const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const textGeneration = yield* TextGeneration;
  const serverSettings = yield* ServerSettingsService;

  const generateAndRename = Effect.fnUntraced(function* (
    input: Parameters<FirstTurnThreadTitleShape["maybeGenerateAndRename"]>[0],
  ) {
    const thread = Option.getOrUndefined(
      yield* projectionSnapshotQuery.getThreadDetailById(input.threadId),
    );
    if (!thread) return;

    const userMessages = thread.messages.filter(
      (message) =>
        message.role === "user" &&
        (message.source === "native" || message.source === "terminal"),
    );
    if (userMessages.length !== 1 || userMessages[0]?.id !== input.messageId) return;

    const fallbackTitle = buildPromptThreadTitleFallback(
      input.messageText.trim() || attachmentTitleSeed(input.attachments?.[0]) || "",
    );
    const currentTitle = thread.title.trim();
    const temporarySidechat = isTemporarySidechatThread(thread);
    const currentTitleBody = temporarySidechat
      ? stripTemporarySidechatTitlePrefix(currentTitle)
      : currentTitle;
    const legacySelectionTitle = temporarySidechat
      ? input.attachments?.find((attachment) => attachment.type === "assistant-selection")?.text
      : undefined;
    const legacySelectionFallback = legacySelectionTitle
      ? buildPromptThreadTitleFallback(legacySelectionTitle)
      : null;
    if (
      !isGenericChatThreadTitle(currentTitleBody) &&
      !isGenericTerminalThreadTitle(currentTitleBody) &&
      currentTitleBody !== fallbackTitle &&
      currentTitleBody !== legacySelectionFallback
    ) {
      return;
    }

    const project = Option.getOrUndefined(
      yield* projectionSnapshotQuery.getProjectShellById(thread.projectId),
    );
    const requestedSelection = input.modelSelection ?? thread.modelSelection;
    const requestedProviderOptions = input.providerOptions;
    let textGenerationInput = resolveTextGenerationInputForSelection(
      requestedSelection,
      requestedProviderOptions,
    );
    if (!textGenerationInput) {
      const settings = yield* serverSettings.getSettings;
      textGenerationInput = resolveTextGenerationInputForSelection(
        settings.textGenerationModelSelection,
        requestedProviderOptions,
      );
    }

    const resolveTitle = (title: string) =>
      temporarySidechat ? formatTemporarySidechatTitle(title) : title;
    if (!textGenerationInput) {
      const nextTitle = resolveTitle(fallbackTitle);
      if (nextTitle !== currentTitle) {
        yield* orchestrationEngine.dispatch({
          type: "thread.meta.update",
          commandId: serverCommandId("thread-title-fallback-rename"),
          threadId: input.threadId,
          title: nextTitle,
        });
      }
      return;
    }

    const textGenerationSelection = textGenerationInput.modelSelection ?? null;
    const textGenerationModel =
      textGenerationSelection?.model ??
      ("model" in textGenerationInput ? textGenerationInput.model : null);
    yield* Effect.logDebug("generating first-turn thread title", {
      threadId: input.threadId,
      cwd: project?.workspaceRoot,
      threadProvider: thread.modelSelection.provider,
      threadModel: thread.modelSelection.model,
      requestedProvider: input.modelSelection?.provider ?? null,
      requestedModel: input.modelSelection?.model ?? null,
      textGenerationProvider: textGenerationSelection?.provider ?? null,
      textGenerationModel,
      textGenerationOptions: textGenerationSelection?.options ?? null,
      hasProviderOptions: Boolean(textGenerationInput.providerOptions),
    });
    const titleGenerationInput: ThreadTitleGenerationInput = {
      cwd: project?.workspaceRoot ?? process.cwd(),
      message: input.messageText,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      ...("model" in textGenerationInput && typeof textGenerationInput.model === "string"
        ? { model: textGenerationInput.model }
        : {}),
      ...(textGenerationInput.modelSelection
        ? { modelSelection: textGenerationInput.modelSelection }
        : {}),
      ...(textGenerationInput.providerOptions
        ? { providerOptions: textGenerationInput.providerOptions }
        : {}),
    };
    const generatedTitle = yield* textGeneration.generateThreadTitle(titleGenerationInput).pipe(
      Effect.map((generated) => generated.title),
      Effect.catch((error) =>
        Effect.logWarning("failed to generate first-turn thread title", {
          threadId: input.threadId,
          reason: error.message,
          textGenerationProvider: textGenerationSelection?.provider ?? null,
          textGenerationModel,
        }).pipe(Effect.as(fallbackTitle)),
      ),
    );
    const nextTitle = resolveTitle(generatedTitle);
    if (nextTitle === currentTitle) return;

    yield* orchestrationEngine.dispatch({
      type: "thread.meta.update",
      commandId: serverCommandId("thread-title-rename"),
      threadId: input.threadId,
      title: nextTitle,
    });
  });

  return {
    maybeGenerateAndRename: (input) =>
      generateAndRename(input).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to update first-turn thread title", {
            threadId: input.threadId,
            cause: Cause.pretty(cause),
          }),
        ),
      ),
  } satisfies FirstTurnThreadTitleShape;
});

export const FirstTurnThreadTitleLive = Layer.effect(FirstTurnThreadTitle, make);
