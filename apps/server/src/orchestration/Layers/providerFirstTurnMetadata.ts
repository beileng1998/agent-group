import {
  type ChatAttachment,
  type CommandId,
  type ModelSelection,
  type OrchestrationThread,
  type ProviderStartOptions,
  type ThreadId,
} from "@agent-group/contracts";
import {
  formatTemporarySidechatTitle,
  isTemporarySidechatThread,
  stripTemporarySidechatTitlePrefix,
} from "@agent-group/shared/agentGroupSessions";
import {
  buildPromptThreadTitleFallback,
  isGenericChatThreadTitle,
} from "@agent-group/shared/chatThreads";
import { isTemporaryWorktreeBranch, WORKTREE_BRANCH_PREFIX } from "@agent-group/shared/git";
import { Cause, Effect } from "effect";

import type { GitCoreShape } from "../../git/Services/GitCore.ts";
import type {
  BranchNameGenerationInput,
  TextGenerationShape,
  ThreadTitleGenerationInput,
} from "../../git/Services/TextGeneration.ts";
import type { TextGenerationProviderInput } from "../../git/textGenerationSelection.ts";
import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";
import { attachmentTitleSeed } from "./providerTurnPrompt.ts";

interface ResolveTextGenerationInput {
  readonly threadId: ThreadId;
  readonly modelSelection?: ModelSelection;
  readonly providerOptions?: ProviderStartOptions;
  readonly useConfiguredFallback?: boolean;
}

export interface ProviderFirstTurnMetadataDependencies<
  ResolveThreadError = never,
  ResolveWorkspaceError = never,
  ResolveTextGenerationInputError = never,
> {
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly git: GitCoreShape;
  readonly textGeneration: TextGenerationShape;
  readonly resolveThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThread | undefined, ResolveThreadError>;
  readonly resolveProjectedThreadWorkspaceCwd: (
    thread: Pick<OrchestrationThread, "projectId">,
  ) => Effect.Effect<string | undefined, ResolveWorkspaceError>;
  readonly resolveThreadTextGenerationInput: (
    input: ResolveTextGenerationInput,
  ) => Effect.Effect<TextGenerationProviderInput | null, ResolveTextGenerationInputError>;
  readonly serverCommandId: (tag: string) => CommandId;
}

export interface FirstTurnBranchInput {
  readonly threadId: ThreadId;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly messageId: string;
  readonly messageText: string;
  readonly attachments?: ReadonlyArray<ChatAttachment>;
  readonly modelSelection?: ModelSelection;
  readonly providerOptions?: ProviderStartOptions;
}

export interface FirstTurnTitleInput {
  readonly threadId: ThreadId;
  readonly messageId: string;
  readonly messageText: string;
  readonly attachments?: ReadonlyArray<ChatAttachment>;
  readonly modelSelection?: ModelSelection;
  readonly providerOptions?: ProviderStartOptions;
}

function buildGeneratedWorktreeBranchName(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, "")
    .replace(/['"`]/g, "");

  const withoutPrefix = normalized.replace(/^agent-group\//, "");
  const branchFragment = withoutPrefix
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");

  return `${WORKTREE_BRANCH_PREFIX}/${branchFragment || "update"}`;
}

/** Owns first-turn title and temporary worktree branch naming side effects. */
export function makeProviderFirstTurnMetadata<
  ResolveThreadError,
  ResolveWorkspaceError,
  ResolveTextGenerationInputError,
>(
  dependencies: ProviderFirstTurnMetadataDependencies<
    ResolveThreadError,
    ResolveWorkspaceError,
    ResolveTextGenerationInputError
  >,
) {
  const renameTemporaryWorktreeBranch = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly oldBranch: string;
    readonly targetBranch: string;
  }) {
    if (input.targetBranch === input.oldBranch) return;

    const renamed = yield* dependencies.git.renameBranch({
      cwd: input.cwd,
      oldBranch: input.oldBranch,
      newBranch: input.targetBranch,
    });
    yield* dependencies.git.publishBranch({ cwd: input.cwd, branch: renamed.branch }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider command reactor failed to publish renamed branch", {
          threadId: input.threadId,
          cwd: input.cwd,
          branch: renamed.branch,
          cause: Cause.pretty(cause),
        }),
      ),
    );
    yield* dependencies.orchestrationEngine.dispatch({
      type: "thread.meta.update",
      commandId: dependencies.serverCommandId("worktree-branch-rename"),
      threadId: input.threadId,
      branch: renamed.branch,
      worktreePath: input.cwd,
      associatedWorktreePath: input.cwd,
      associatedWorktreeBranch: renamed.branch,
      associatedWorktreeRef: renamed.branch,
    });
  });

  const maybeGenerateAndRenameWorktreeBranchForFirstTurn = Effect.fnUntraced(function* (
    input: FirstTurnBranchInput,
  ) {
    if (!input.branch || !input.worktreePath || !isTemporaryWorktreeBranch(input.branch)) return;

    const thread = yield* dependencies.resolveThread(input.threadId);
    if (!thread) return;
    const userMessages = thread.messages.filter(
      (message) => message.role === "user" && message.source === "native",
    );
    if (userMessages.length !== 1 || userMessages[0]?.id !== input.messageId) return;

    const oldBranch = input.branch;
    const cwd = input.worktreePath;
    const attachments = input.attachments ?? [];
    const textGenerationInput = yield* dependencies.resolveThreadTextGenerationInput({
      threadId: input.threadId,
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
    });
    if (!textGenerationInput) {
      const targetBranch = buildGeneratedWorktreeBranchName(
        input.messageText.trim() || attachmentTitleSeed(attachments[0]) || "",
      );
      yield* renameTemporaryWorktreeBranch({
        threadId: input.threadId,
        cwd,
        oldBranch,
        targetBranch,
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(
            "provider command reactor failed to apply fallback worktree branch name",
            { threadId: input.threadId, cwd, oldBranch, targetBranch, cause: Cause.pretty(cause) },
          ),
        ),
      );
      return;
    }

    const branchNameGenerationInput: BranchNameGenerationInput = {
      cwd,
      message: input.messageText,
      ...(attachments.length > 0 ? { attachments } : {}),
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
    yield* dependencies.textGeneration.generateBranchName(branchNameGenerationInput).pipe(
      Effect.catch((error) =>
        Effect.logWarning(
          "provider command reactor failed to generate worktree branch name; skipping rename",
          { threadId: input.threadId, cwd, oldBranch, reason: error.message },
        ),
      ),
      Effect.flatMap((generated) => {
        if (!generated) return Effect.void;
        return renameTemporaryWorktreeBranch({
          threadId: input.threadId,
          cwd,
          oldBranch,
          targetBranch: buildGeneratedWorktreeBranchName(generated.branch),
        });
      }),
      Effect.catchCause((cause) =>
        Effect.logWarning("provider command reactor failed to generate or rename worktree branch", {
          threadId: input.threadId,
          cwd,
          oldBranch,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  });

  const maybeGenerateAndRenameThreadTitleForFirstTurn = Effect.fnUntraced(function* (
    input: FirstTurnTitleInput,
  ) {
    const thread = yield* dependencies.resolveThread(input.threadId);
    if (!thread) return;
    const userMessages = thread.messages.filter(
      (message) => message.role === "user" && message.source === "native",
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
      currentTitleBody !== fallbackTitle &&
      currentTitleBody !== legacySelectionFallback
    ) {
      return;
    }

    const resolveThreadTitle = (title: string) =>
      temporarySidechat ? formatTemporarySidechatTitle(title) : title;
    const cwd = yield* dependencies.resolveProjectedThreadWorkspaceCwd(thread);
    const textGenerationInput = yield* dependencies.resolveThreadTextGenerationInput({
      threadId: input.threadId,
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      useConfiguredFallback: true,
    });
    if (!textGenerationInput) {
      const nextTitle = resolveThreadTitle(fallbackTitle);
      if (nextTitle !== currentTitle) {
        yield* dependencies.orchestrationEngine.dispatch({
          type: "thread.meta.update",
          commandId: dependencies.serverCommandId("thread-title-fallback-rename"),
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
    const textGenerationProviderOptions = textGenerationInput.providerOptions;
    yield* Effect.logDebug("provider command reactor generating thread title", {
      threadId: input.threadId,
      cwd,
      threadProvider: thread.modelSelection.provider,
      threadModel: thread.modelSelection.model,
      requestedProvider: input.modelSelection?.provider ?? null,
      requestedModel: input.modelSelection?.model ?? null,
      textGenerationProvider: textGenerationSelection?.provider ?? null,
      textGenerationModel,
      textGenerationOptions: textGenerationSelection?.options ?? null,
      hasProviderOptions: Boolean(textGenerationProviderOptions),
    });
    const titleGenerationInput: ThreadTitleGenerationInput = {
      cwd: cwd ?? process.cwd(),
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
    const generatedTitle = yield* dependencies.textGeneration
      .generateThreadTitle(titleGenerationInput)
      .pipe(
        Effect.map((generated) => generated.title),
        Effect.catch((error) =>
          Effect.logWarning("provider command reactor failed to generate thread title", {
            threadId: input.threadId,
            cwd,
            reason: error.message,
            threadProvider: thread.modelSelection.provider,
            threadModel: thread.modelSelection.model,
            requestedProvider: input.modelSelection?.provider ?? null,
            requestedModel: input.modelSelection?.model ?? null,
            textGenerationProvider: textGenerationSelection?.provider ?? null,
            textGenerationModel,
            textGenerationOptions: textGenerationSelection?.options ?? null,
          }).pipe(Effect.as(fallbackTitle)),
        ),
      );
    const nextTitle = resolveThreadTitle(generatedTitle);
    if (nextTitle === currentTitle) return;

    yield* dependencies.orchestrationEngine.dispatch({
      type: "thread.meta.update",
      commandId: dependencies.serverCommandId("thread-title-rename"),
      threadId: input.threadId,
      title: nextTitle,
    });
  });

  return {
    maybeGenerateAndRenameThreadTitleForFirstTurn,
    maybeGenerateAndRenameWorktreeBranchForFirstTurn,
  } as const;
}
