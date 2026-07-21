// FILE: executePreparedComposerTurn.ts
// Purpose: Execute the workspace, promotion, setup, and provider-dispatch stages of one send.
// Layer: Web send orchestration

import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ClientOrchestrationCommand,
  type NativeApi,
  type ProjectScript,
  type ProviderStartOptions,
  type ThreadId,
} from "@agent-group/contracts";

import type { Project, Thread } from "../types";
import { buildModelSelection } from "../providerModelOptions";
import { promoteLocalDraftForChatTurn } from "./chatThreadPromotion";
import { prepareChatTurnWorkspace } from "./chatTurnWorkspacePreparation";
import { dispatchPreparedChatTurn } from "./chatTurnStartDispatch";
import { runChatWorktreeSetupScript } from "./chatWorktreeSetupScript";
import { newCommandId } from "./utils";

type TurnStartCommand = Extract<ClientOrchestrationCommand, { type: "thread.turn.start" }>;
type ThreadCreateCommand = Extract<ClientOrchestrationCommand, { type: "thread.create" }>;

interface PreparedComposerTurnThread {
  id: ThreadId;
  isServerThread: boolean;
  isLocalDraftThread: boolean;
  activeCreatedAt: Thread["createdAt"];
  activeLastKnownPr: Thread["lastKnownPr"];
  notes: string;
  title: string;
  targetProjectId: Project["id"];
  targetProjectKind: Project["kind"];
  targetProjectCwd: string;
  targetProjectDefaultModelSelection: Project["defaultModelSelection"];
  envMode: ThreadCreateCommand["envMode"];
  initialBranch: string | null;
  initialWorktreePath: string | null;
  baseBranchForWorktree: string | null;
  setupScriptForWorktree: ProjectScript | null;
}

interface PreparedComposerTurnRequest {
  messageId: TurnStartCommand["message"]["messageId"];
  messageText: string;
  attachments: Promise<TurnStartCommand["message"]["attachments"]>;
  mentionedSkills: NonNullable<TurnStartCommand["message"]["skills"]>;
  mentionedMentions: NonNullable<TurnStartCommand["message"]["mentions"]>;
  modelSelection: NonNullable<TurnStartCommand["modelSelection"]>;
  selectedModel: string | null;
  providerOptions: ProviderStartOptions | undefined;
  assistantDeliveryMode: TurnStartCommand["assistantDeliveryMode"];
  dispatchMode: TurnStartCommand["dispatchMode"];
  runtimeMode: TurnStartCommand["runtimeMode"];
  interactionMode: TurnStartCommand["interactionMode"];
  sourceProposedPlan: TurnStartCommand["sourceProposedPlan"] | undefined;
  createdAt: TurnStartCommand["createdAt"];
}

export async function executePreparedComposerTurn(input: {
  api: NativeApi;
  thread: PreparedComposerTurnThread;
  turn: PreparedComposerTurnRequest;
  createWorktree: Parameters<typeof prepareChatTurnWorkspace>[0]["createWorktree"];
  onPreparingThread: () => void;
  onServerWorkspaceReady: Parameters<typeof prepareChatTurnWorkspace>[0]["onServerWorkspaceReady"];
  dispatchThreadNotes: Parameters<typeof promoteLocalDraftForChatTurn>[0]["dispatchThreadNotes"];
  onDraftPromotion: (created: boolean) => void;
  onSetupScriptRunning: (name: string) => void;
  runProjectScript: Parameters<typeof runChatWorktreeSetupScript>[0]["runProjectScript"];
  waitForTerminalActivity: Parameters<
    typeof runChatWorktreeSetupScript
  >[0]["waitForTerminalActivity"];
  persistSettings: (() => Promise<unknown>) | null;
  onStartingSession: () => void;
  rememberProviderDispatch: () => void;
}): Promise<void> {
  const workspace = await prepareChatTurnWorkspace({
    api: input.api,
    threadId: input.thread.id,
    isServerThread: input.thread.isServerThread,
    targetProjectCwd: input.thread.targetProjectCwd,
    baseBranchForWorktree: input.thread.baseBranchForWorktree,
    initialBranch: input.thread.initialBranch,
    initialWorktreePath: input.thread.initialWorktreePath,
    createWorktree: input.createWorktree,
    onPreparingThread: input.onPreparingThread,
    onServerWorkspaceReady: input.onServerWorkspaceReady,
  });

  const threadCreateModelSelection = buildModelSelection(
    input.turn.modelSelection.provider,
    input.turn.modelSelection.model ||
      input.turn.selectedModel ||
      input.thread.targetProjectDefaultModelSelection?.model ||
      DEFAULT_MODEL_BY_PROVIDER.codex,
    input.turn.modelSelection.options,
  );
  const createdServerThread = await promoteLocalDraftForChatTurn({
    api: input.api,
    isLocalDraftThread: input.thread.isLocalDraftThread,
    targetProjectKind: input.thread.targetProjectKind,
    title: input.thread.title,
    threadNotes: input.thread.notes,
    threadCreate: {
      type: "thread.create",
      commandId: newCommandId(),
      threadId: input.thread.id,
      projectId: input.thread.targetProjectId,
      title: input.thread.title,
      modelSelection: threadCreateModelSelection,
      runtimeMode: input.turn.runtimeMode,
      interactionMode: input.turn.interactionMode,
      envMode: input.thread.envMode,
      branch: workspace.branch,
      worktreePath: workspace.worktreePath,
      lastKnownPr: input.thread.activeLastKnownPr ?? null,
      createdAt: input.thread.activeCreatedAt,
    },
    dispatchThreadNotes: input.dispatchThreadNotes,
  });
  input.onDraftPromotion(createdServerThread);

  await runChatWorktreeSetupScript({
    threadId: input.thread.id,
    setupScript: input.thread.setupScriptForWorktree,
    worktreePath: workspace.worktreePath,
    isServerThread: input.thread.isServerThread,
    createdServerThreadForLocalDraft: createdServerThread,
    onRunning: input.onSetupScriptRunning,
    runProjectScript: input.runProjectScript,
    waitForTerminalActivity: input.waitForTerminalActivity,
  });

  await dispatchPreparedChatTurn({
    api: input.api,
    persistSettings: input.persistSettings,
    onStartingSession: input.onStartingSession,
    attachments: input.turn.attachments,
    rememberProviderDispatch: input.rememberProviderDispatch,
    buildCommand: (attachments) => ({
      type: "thread.turn.start",
      commandId: newCommandId(),
      threadId: input.thread.id,
      message: {
        messageId: input.turn.messageId,
        role: "user",
        text: input.turn.messageText,
        attachments,
        ...(input.turn.mentionedSkills.length > 0 ? { skills: input.turn.mentionedSkills } : {}),
        ...(input.turn.mentionedMentions.length > 0
          ? { mentions: input.turn.mentionedMentions }
          : {}),
      },
      modelSelection: input.turn.modelSelection,
      ...(input.turn.providerOptions ? { providerOptions: input.turn.providerOptions } : {}),
      assistantDeliveryMode: input.turn.assistantDeliveryMode,
      dispatchMode: input.turn.dispatchMode,
      runtimeMode: input.turn.runtimeMode,
      interactionMode: input.turn.interactionMode,
      ...(input.turn.sourceProposedPlan
        ? { sourceProposedPlan: input.turn.sourceProposedPlan }
        : {}),
      createdAt: input.turn.createdAt,
    }),
  });
}
