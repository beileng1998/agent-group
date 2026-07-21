import {
  type AgentGroupServerSettings,
  type ChatAttachment,
  type MessageMentionReference,
  type ModelSelection,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type ProviderKind,
  type ProviderMentionReference,
  type ProviderReviewTarget,
  type ProviderSession,
  type ProviderSkillReference,
  type ProviderStartOptions,
  type RuntimeMode,
  type ThreadId,
  type OrchestrationThread,
} from "@agent-group/contracts";
import { isProviderMentionReference } from "@agent-group/shared/messageMentions";
import { Effect } from "effect";

import {
  prepareAgentGroupTurn,
  type AgentGroupMentionedSession,
  type PreparedAgentGroupTurn,
} from "../../agentGroup/runtime.ts";
import type { AgentGroupCoordinates } from "../../agentGroup/state.ts";
import { buildInlineSkillInstructions } from "../../provider/skillPromptInjection.ts";
import type { ProviderServiceShape } from "../../provider/Services/ProviderService.ts";
import {
  buildForkBootstrapText,
  buildHandoffBootstrapText,
  buildPriorTranscriptBootstrapText,
  hasNativeAssistantMessagesBefore,
  listImportedForkMessages,
  listPriorTranscriptMessages,
} from "../handoff.ts";
import type { EnsureProviderSessionOptions } from "./providerSessionCoordinator.ts";
import type { ProviderTurnBootstrapState } from "./providerTurnBootstrapState.ts";
import {
  availableProviderContextChars,
  normalizeSkillMentionTextForProvider,
  resolveAgentGroupPromptAttachments,
  toNonEmptyProviderInput,
  wrapProviderContext,
  wrapSidechatInput,
} from "./providerTurnPrompt.ts";
import { ProviderAdapterRequestError } from "../../provider/Errors.ts";

export interface ProviderTurnDispatchInput {
  readonly threadId: ThreadId;
  readonly messageId: string;
  readonly messageText: string;
  readonly attachments?: ReadonlyArray<ChatAttachment>;
  readonly skills?: ReadonlyArray<ProviderSkillReference>;
  readonly mentions?: ReadonlyArray<MessageMentionReference>;
  readonly reviewTarget?: ProviderReviewTarget;
  readonly modelSelection?: ModelSelection;
  readonly providerOptions?: ProviderStartOptions;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: "default" | "plan";
  readonly dispatchMode?: "queue" | "steer";
  readonly createdAt: string;
}

export interface PreparedProviderTurn {
  readonly thread: OrchestrationThread;
  readonly providerMentions: ReadonlyArray<ProviderMentionReference> | undefined;
  readonly agentGroupCoordinates: AgentGroupCoordinates | null;
  readonly agentGroupTurn: PreparedAgentGroupTurn | null;
  readonly activeSessionBeforeEnsure: ProviderSession | undefined;
  readonly boundaryMessageText: string;
  readonly selectedProvider: ProviderKind;
  readonly hasPendingPriorTranscriptBootstrap: boolean;
  readonly shouldBootstrapHandoff: boolean;
  readonly handoffBootstrapText: string | null;
  readonly shouldBootstrapSidechatContext: boolean;
  readonly sidechatBootstrapText: string | null;
  readonly hasSidechatBootstrapContent: boolean;
  readonly shouldBootstrapPriorTranscriptContext: boolean;
  readonly priorTranscriptBootstrapText: string | null;
  readonly priorTranscriptBootstrapAvailableChars: number;
  readonly hasPriorTranscriptBootstrapContent: boolean;
  readonly skillInlineText: string;
  readonly normalizedInput: string | undefined;
  readonly normalizedAttachments: ReadonlyArray<ChatAttachment>;
  readonly activeSession: ProviderSession | undefined;
  readonly modelForTurn: ModelSelection;
}

export function makeProviderTurnPreparation<
  ThreadError,
  CoordinatesError,
  MentionError,
  EnsureError,
>(dependencies: {
  readonly providerService: ProviderServiceShape;
  readonly attachmentsDir: string;
  readonly bootstrapState: ProviderTurnBootstrapState;
  readonly resolveThread: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationThread | undefined, ThreadError>;
  readonly resolveAgentGroupCoordinates: (
    thread: OrchestrationThread,
  ) => Effect.Effect<AgentGroupCoordinates | null, CoordinatesError>;
  readonly resolveMentionedAgentGroupSessions: (
    thread: OrchestrationThread,
    mentions: ReadonlyArray<MessageMentionReference>,
  ) => Effect.Effect<ReadonlyArray<AgentGroupMentionedSession>, MentionError>;
  readonly getAgentGroupSettings: () => Effect.Effect<AgentGroupServerSettings>;
  readonly ensureSessionForThread: (
    threadId: ThreadId,
    createdAt: string,
    options?: EnsureProviderSessionOptions,
  ) => Effect.Effect<unknown, EnsureError>;
  readonly getSessionModelSelection: (threadId: ThreadId) => ModelSelection | undefined;
  readonly recordProviderOptions: (threadId: ThreadId, options: ProviderStartOptions) => void;
  readonly recordModelSelection: (threadId: ThreadId, selection: ModelSelection) => void;
}) {
  const prepare = Effect.fnUntraced(function* (input: ProviderTurnDispatchInput) {
    const thread = yield* dependencies.resolveThread(input.threadId);
    if (!thread) return undefined;

    const providerMentions = input.mentions?.filter(isProviderMentionReference);
    const agentGroupCoordinates =
      input.reviewTarget === undefined
        ? yield* dependencies.resolveAgentGroupCoordinates(thread)
        : null;
    const mentionedSessions = agentGroupCoordinates
      ? yield* dependencies.resolveMentionedAgentGroupSessions(thread, input.mentions ?? [])
      : [];
    const agentGroupSettings = agentGroupCoordinates
      ? yield* dependencies.getAgentGroupSettings()
      : undefined;
    const agentGroupTurn = agentGroupCoordinates
      ? yield* Effect.tryPromise(() =>
          prepareAgentGroupTurn({
            ...agentGroupCoordinates,
            userText:
              input.messageText || (input.attachments?.length ? "Review the attachments." : ""),
            attachments: resolveAgentGroupPromptAttachments(
              input.attachments,
              dependencies.attachmentsDir,
            ),
            ...(mentionedSessions.length > 0 ? { mentionedSessions } : {}),
            ...(agentGroupSettings ? { globalSettings: agentGroupSettings } : {}),
          }),
        )
      : null;
    const activeSessionBeforeEnsure = yield* dependencies.providerService
      .listSessions()
      .pipe(
        Effect.map((sessions) => sessions.find((session) => session.threadId === input.threadId)),
      );
    const suppressFreshSessionBootstrap = dependencies.bootstrapState.isNextStartSuppressed(
      input.threadId,
    );
    yield* dependencies.ensureSessionForThread(input.threadId, input.createdAt, {
      ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
      ...(input.providerOptions !== undefined ? { providerOptions: input.providerOptions } : {}),
      ...(input.runtimeMode !== undefined ? { runtimeMode: input.runtimeMode } : {}),
    });
    if (
      agentGroupTurn &&
      activeSessionBeforeEnsure === undefined &&
      !suppressFreshSessionBootstrap
    ) {
      dependencies.bootstrapState.registerFreshSession(input.threadId);
    }
    if (input.providerOptions !== undefined) {
      dependencies.recordProviderOptions(input.threadId, input.providerOptions);
    }
    if (input.modelSelection !== undefined) {
      dependencies.recordModelSelection(input.threadId, input.modelSelection);
    }

    const boundaryMessageText =
      agentGroupTurn?.prompt ??
      (thread.sidechatSourceThreadId ? wrapSidechatInput(input.messageText) : input.messageText);
    const shouldBootstrapHandoff =
      agentGroupTurn === null &&
      thread.handoff?.bootstrapStatus === "pending" &&
      !hasNativeAssistantMessagesBefore(thread, input.messageId);
    const handoffBootstrapAvailableChars = availableProviderContextChars({
      tag: "handoff_context",
      messageText: boundaryMessageText,
      wrapLatestUserMessage: true,
    });
    const handoffBootstrapText =
      shouldBootstrapHandoff && handoffBootstrapAvailableChars > 0
        ? buildHandoffBootstrapText(thread, handoffBootstrapAvailableChars)
        : null;
    const selectedProvider = (input.modelSelection?.provider ??
      dependencies.getSessionModelSelection(input.threadId)?.provider ??
      thread.session?.providerName ??
      thread.modelSelection.provider) as ProviderKind;
    const hasPendingPriorTranscriptBootstrap =
      dependencies.bootstrapState.hasPendingPriorTranscript(input.threadId);
    const shouldBootstrapSidechatContext =
      agentGroupTurn === null &&
      thread.sidechatSourceThreadId !== null &&
      dependencies.bootstrapState.hasSidechat(input.threadId) &&
      !hasNativeAssistantMessagesBefore(thread, input.messageId) &&
      !shouldBootstrapHandoff &&
      !hasPendingPriorTranscriptBootstrap;
    const sidechatBootstrapAvailableChars = availableProviderContextChars({
      tag: "sidechat_context",
      messageText: boundaryMessageText,
      wrapLatestUserMessage: false,
    });
    const sidechatBootstrapText =
      shouldBootstrapSidechatContext && sidechatBootstrapAvailableChars > 0
        ? buildForkBootstrapText(thread, sidechatBootstrapAvailableChars)
        : null;
    const hasSidechatBootstrapContent =
      shouldBootstrapSidechatContext && listImportedForkMessages(thread).length > 0;
    if (
      input.reviewTarget === undefined &&
      hasSidechatBootstrapContent &&
      sidechatBootstrapAvailableChars === 0
    ) {
      return yield* new ProviderAdapterRequestError({
        provider: selectedProvider,
        method: "thread.turn.start",
        detail:
          "The latest message is too long to include the sidechat context required by this provider session. Shorten the message and retry.",
      });
    }

    const shouldBootstrapPriorTranscriptContext =
      ((agentGroupTurn === null &&
        (selectedProvider === "kilo" || selectedProvider === "opencode") &&
        activeSessionBeforeEnsure === undefined) ||
        hasPendingPriorTranscriptBootstrap) &&
      !shouldBootstrapHandoff &&
      !shouldBootstrapSidechatContext;
    const hasPriorTranscriptBootstrapContent =
      shouldBootstrapPriorTranscriptContext &&
      listPriorTranscriptMessages(thread, input.messageId).length > 0;
    const priorTranscriptBootstrapAvailableChars = availableProviderContextChars({
      tag: "thread_context",
      messageText: boundaryMessageText,
      wrapLatestUserMessage: true,
    });
    if (
      input.reviewTarget === undefined &&
      hasPendingPriorTranscriptBootstrap &&
      shouldBootstrapPriorTranscriptContext &&
      priorTranscriptBootstrapAvailableChars === 0 &&
      hasPriorTranscriptBootstrapContent
    ) {
      return yield* new ProviderAdapterRequestError({
        provider: selectedProvider,
        method: "thread.turn.start",
        detail:
          "The latest message is too long to include the transcript context required by the restarted provider session. Shorten the message and retry.",
      });
    }
    const priorTranscriptBootstrapText =
      shouldBootstrapPriorTranscriptContext && priorTranscriptBootstrapAvailableChars > 0
        ? buildPriorTranscriptBootstrapText(
            thread,
            input.messageId,
            priorTranscriptBootstrapAvailableChars,
          )
        : null;
    const providerInput = handoffBootstrapText
      ? wrapProviderContext({
          tag: "handoff_context",
          contextText: handoffBootstrapText,
          messageText: boundaryMessageText,
          wrapLatestUserMessage: true,
        })
      : sidechatBootstrapText
        ? wrapProviderContext({
            tag: "sidechat_context",
            contextText: sidechatBootstrapText,
            messageText: boundaryMessageText,
            wrapLatestUserMessage: false,
          })
        : priorTranscriptBootstrapText
          ? wrapProviderContext({
              tag: "thread_context",
              contextText: priorTranscriptBootstrapText,
              messageText: boundaryMessageText,
              wrapLatestUserMessage: true,
            })
          : boundaryMessageText;
    const skillInlineText =
      input.skills !== undefined && input.skills.length > 0
        ? yield* Effect.tryPromise(() =>
            buildInlineSkillInstructions({
              provider: selectedProvider,
              skills: input.skills ?? [],
              maxChars: Math.max(
                0,
                PROVIDER_SEND_TURN_MAX_INPUT_CHARS - providerInput.length - 1_000,
              ),
            }),
          ).pipe(
            Effect.catch((error) =>
              Effect.logWarning("failed to inline portable skill instructions", {
                threadId: input.threadId,
                error,
              }).pipe(Effect.as("")),
            ),
          )
        : "";
    const providerInputWithSkills = skillInlineText
      ? `${providerInput}\n\n${skillInlineText}`
      : providerInput;
    const normalizedInput = toNonEmptyProviderInput(
      normalizeSkillMentionTextForProvider({
        provider: selectedProvider,
        messageText: providerInputWithSkills,
        ...(input.skills !== undefined ? { skills: input.skills } : {}),
      }),
    );
    const normalizedAttachments = input.attachments ?? [];
    const activeSession = yield* dependencies.providerService
      .listSessions()
      .pipe(
        Effect.map((sessions) => sessions.find((session) => session.threadId === input.threadId)),
      );
    const sessionModelSwitch =
      activeSession === undefined
        ? "in-session"
        : (yield* dependencies.providerService.getCapabilities(activeSession.provider))
            .sessionModelSwitch;
    const requestedModelSelection = input.modelSelection ?? thread.modelSelection;
    const modelForTurn =
      sessionModelSwitch === "unsupported" && activeSession?.model !== undefined
        ? { ...requestedModelSelection, model: activeSession.model }
        : requestedModelSelection;

    return {
      thread,
      providerMentions,
      agentGroupCoordinates,
      agentGroupTurn,
      activeSessionBeforeEnsure,
      boundaryMessageText,
      selectedProvider,
      hasPendingPriorTranscriptBootstrap,
      shouldBootstrapHandoff,
      handoffBootstrapText,
      shouldBootstrapSidechatContext,
      sidechatBootstrapText,
      hasSidechatBootstrapContent,
      shouldBootstrapPriorTranscriptContext,
      priorTranscriptBootstrapText,
      priorTranscriptBootstrapAvailableChars,
      hasPriorTranscriptBootstrapContent,
      skillInlineText,
      normalizedInput,
      normalizedAttachments,
      activeSession,
      modelForTurn,
    } satisfies PreparedProviderTurn;
  });

  return { prepare } as const;
}
