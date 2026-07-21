import type {
  AgentInfo,
  ModelInfo,
  PermissionMode,
  PermissionUpdate,
  SDKControlGetContextUsageResponse,
  SDKMessage,
  SDKUserMessage,
  Settings,
  SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  ApprovalRequestId,
  CanonicalItemType,
  CanonicalRequestType,
  ProviderApprovalDecision,
  ProviderSession,
  ProviderUserInputAnswers,
  RuntimeContentStreamKind,
  ThreadTokenUsageSnapshot,
  TurnId,
  UserInputQuestion,
} from "@agent-group/contracts";
import type { Deferred, Fiber, Queue } from "effect";

import type { ClaudeSubagentRouteRegistry } from "./claudeSubagentRouting.ts";
import type { ClaudeTrackedTask } from "./claudeTaskTracker.ts";

export type ClaudeTextStreamKind = Extract<
  RuntimeContentStreamKind,
  "assistant_text" | "reasoning_text"
>;

export type ClaudeToolResultStreamKind = Extract<
  RuntimeContentStreamKind,
  "command_output" | "file_change_output"
>;

export type ClaudePromptQueueItem =
  | {
      readonly type: "message";
      readonly message: SDKUserMessage;
    }
  | {
      readonly type: "terminate";
    };

export interface ClaudeAssistantTextBlockState {
  readonly itemId: string;
  readonly blockIndex: number;
  emittedTextDelta: boolean;
  fallbackText: string;
  streamClosed: boolean;
  completionEmitted: boolean;
}

export interface ClaudeTurnState {
  readonly turnId: TurnId;
  readonly startedAt: string;
  readonly interactionMode: "default" | "plan";
  readonly items: Array<unknown>;
  readonly assistantTextBlocks: Map<number, ClaudeAssistantTextBlockState>;
  readonly assistantTextBlockOrder: Array<ClaudeAssistantTextBlockState>;
  readonly capturedProposedPlanKeys: Set<string>;
  readonly sawFileChange: boolean;
  nextSyntheticAssistantBlockIndex: number;
}

export interface ClaudePendingApproval {
  readonly requestType: CanonicalRequestType;
  readonly detail?: string;
  readonly suggestions?: ReadonlyArray<PermissionUpdate>;
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
}

export interface ClaudePendingUserInput {
  readonly questions: ReadonlyArray<UserInputQuestion>;
  readonly answers: Deferred.Deferred<ProviderUserInputAnswers>;
}

export interface ClaudeToolInFlight {
  readonly itemId: string;
  readonly itemType: CanonicalItemType;
  readonly toolName: string;
  readonly title: string;
  readonly detail?: string;
  readonly input: Record<string, unknown>;
  readonly partialInputJson: string;
  readonly lastEmittedInputFingerprint?: string;
}

export interface ClaudeSubagentRun {
  readonly toolUseId: string;
  readonly context: ClaudeSessionContext;
}

export interface ClaudeSessionContext {
  session: ProviderSession;
  readonly promptQueue: Queue.Queue<ClaudePromptQueueItem>;
  readonly query: ClaudeQueryRuntime;
  readonly modelDiscoveryKey: string;
  streamFiber: Fiber.Fiber<void, Error> | undefined;
  readonly startedAt: string;
  readonly basePermissionMode: PermissionMode | undefined;
  lastInteractionMode: "default" | "plan" | undefined;
  currentApiModelId: string | undefined;
  resumeSessionId: string | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, ClaudePendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, ClaudePendingUserInput>;
  readonly turns: Array<{
    id: TurnId;
    items: Array<unknown>;
  }>;
  readonly inFlightTools: Map<number, ClaudeToolInFlight>;
  readonly trackedTasks: Map<string, ClaudeTrackedTask>;
  turnState: ClaudeTurnState | undefined;
  interruptRequestedTurnId: TurnId | undefined;
  lastKnownContextWindow: number | undefined;
  currentAutoCompactWindow: number | undefined;
  lastKnownAutoCompactThreshold: number | undefined;
  contextUsageControlEnabled: boolean;
  lastKnownTokenUsage: ThreadTokenUsageSnapshot | undefined;
  lastAssistantUuid: string | undefined;
  lastThreadStartedId: string | undefined;
  rerouteOriginalApiModelId: string | undefined;
  readonly emittedContextUsageWarnings: Set<string>;
  stopped: boolean;
  readonly warnedUnhandledSdkKinds: Set<string>;
  readonly subagentRoutes: ClaudeSubagentRouteRegistry;
  readonly subagentRuns: Map<string, ClaudeSubagentRun>;
  readonly subagentRefs?: {
    readonly providerThreadId: string;
    readonly providerParentThreadId: string;
  };
}

export interface ClaudeQueryRuntime extends AsyncIterable<SDKMessage> {
  readonly interrupt: () => Promise<void>;
  readonly stopTask: (taskId: string) => Promise<void>;
  readonly setModel: (model?: string) => Promise<void>;
  readonly setPermissionMode: (mode: PermissionMode) => Promise<void>;
  readonly setMaxThinkingTokens: (maxThinkingTokens: number | null) => Promise<void>;
  readonly applyFlagSettings: (settings: {
    [K in keyof Settings]?: Settings[K] | null;
  }) => Promise<void>;
  readonly getContextUsage: () => Promise<SDKControlGetContextUsageResponse>;
  readonly supportedCommands: () => Promise<SlashCommand[]>;
  readonly supportedModels: () => Promise<ModelInfo[]>;
  readonly supportedAgents: () => Promise<AgentInfo[]>;
  readonly close: () => void;
}
