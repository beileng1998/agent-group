import * as nodePath from "node:path";

import {
  type ApprovalRequestId,
  type GrokModelOptions,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderSession,
  type ProviderUserInputAnswers,
  type RuntimeMode,
  type ThreadId,
  type TurnId,
} from "@agent-group/contracts";
import { Deferred, Effect, Fiber, Scope } from "effect";
import type * as EffectAcpSchema from "effect-acp/schema";

import type { ServerConfigShape } from "../config.ts";
import { NATIVE_PLAN_MODE_PROMPT } from "./planMode.ts";
import { readAcpUsdCost } from "./acp/AcpAdapterSessionSupport.ts";
import type { AcpSessionRuntimeShape } from "./acp/AcpSessionRuntime.ts";
import type {
  AcpSessionMode,
  AcpSessionModeState,
  AcpToolCallState,
} from "./acp/AcpRuntimeModel.ts";
import { applyGrokAcpModelSelection } from "./acp/GrokAcpSupport.ts";

export const GROK_RESUME_VERSION = 1 as const;
const ACP_PLAN_MODE_ALIASES = ["plan"];
const ACP_IMPLEMENT_MODE_ALIASES = ["code", "agent", "default", "chat", "implement"];
const ACP_APPROVAL_MODE_ALIASES = ["ask"];

export interface PendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
  readonly kind: string | "unknown";
}

export interface PendingUserInput {
  readonly answers: Deferred.Deferred<ProviderUserInputAnswers>;
}

export interface GrokSessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  readonly scope: Scope.Closeable;
  readonly acp: AcpSessionRuntimeShape;
  notificationFiber: Fiber.Fiber<void, never> | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  lastPlanFingerprint: string | undefined;
  activeInteractionMode: ProviderInteractionMode | undefined;
  activeTurnId: TurnId | undefined;
  activeTurnHadAssistantContent: boolean;
  readonly activeAssistantItemsWithContent: Set<string>;
  activeTurnFailedToolDetail: string | undefined;
  activePromptFiber: Fiber.Fiber<void, never> | undefined;
  lastTurnActivityAt: number | undefined;
  readonly turnToolCallIds: Map<string, TurnId>;
  sessionUpdatesProcessed: number;
  sessionConfigReady: Deferred.Deferred<void> | undefined;
  resumeReplayReady: Deferred.Deferred<void> | undefined;
  resumeReplayLastSuppressedAt: number | undefined;
  turnStarting: boolean;
  pendingTurnInterrupted: boolean;
  compactingThread: boolean;
  compactionFailedToolDetail: string | undefined;
  compactionQuietUntil: number | undefined;
  compactionCancelFiber: Fiber.Fiber<void> | undefined;
  latestSessionCostUsd: number | undefined;
  stopped: boolean;
}

export function isGrokContextCompactionToolCall(toolCall: AcpToolCallState): boolean {
  const haystack = [toolCall.kind, toolCall.title, toolCall.detail]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  return /\b(compact|summariz)/u.test(haystack);
}

export function clearGrokActiveTurn(ctx: GrokSessionContext, turnId: TurnId): boolean {
  if (ctx.activeTurnId !== turnId) return false;
  ctx.activeTurnId = undefined;
  ctx.activeTurnHadAssistantContent = false;
  ctx.activeAssistantItemsWithContent.clear();
  ctx.activeTurnFailedToolDetail = undefined;
  ctx.activePromptFiber = undefined;
  ctx.activeInteractionMode = undefined;
  const { activeTurnId: _activeTurnId, ...session } = ctx.session;
  ctx.session = session;
  return true;
}

export function scopeGrokRuntimeItemIdForTurn(turnId: TurnId, itemId: string): string {
  return `grok:${turnId}:${itemId}`;
}

export function isRenderableGrokAssistantDelta(input: {
  readonly streamKind?: string | undefined;
  readonly text: string;
}): boolean {
  return input.streamKind !== "reasoning_text" && input.text.trim().length > 0;
}

export function scopeGrokToolCallStateForTurn(
  turnId: TurnId,
  toolCall: AcpToolCallState,
): AcpToolCallState {
  return {
    ...toolCall,
    toolCallId: scopeGrokRuntimeItemIdForTurn(turnId, toolCall.toolCallId),
    data: { ...toolCall.data, providerToolCallId: toolCall.toolCallId },
  };
}

export function parseGrokResume(raw: unknown): { sessionId: string } | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== GROK_RESUME_VERSION) return undefined;
  if (typeof record.sessionId !== "string" || !record.sessionId.trim()) return undefined;
  return { sessionId: record.sessionId.trim() };
}

export function recordGrokSessionCost(
  ctx: GrokSessionContext,
  cost: EffectAcpSchema.Cost | null | undefined,
): void {
  const sessionCostUsd = readAcpUsdCost(cost);
  if (sessionCostUsd !== undefined) ctx.latestSessionCostUsd = sessionCostUsd;
}

export function finalizeGrokActiveTurnCost(ctx: GrokSessionContext): {
  readonly cumulativeCostUsd?: number;
} {
  return ctx.latestSessionCostUsd !== undefined
    ? { cumulativeCostUsd: ctx.latestSessionCostUsd }
    : {};
}

export function withGrokPlanModePrompt(input: {
  readonly text: string;
  readonly interactionMode?: ProviderInteractionMode;
}): string {
  if (input.interactionMode !== "plan") return input.text;
  const text = input.text.trim();
  return text.length > 0
    ? `${NATIVE_PLAN_MODE_PROMPT}\n\nUser request:\n${text}`
    : NATIVE_PLAN_MODE_PROMPT;
}

function normalizeModeSearchText(mode: AcpSessionMode): string {
  return [mode.id, mode.name, mode.description]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findModeByAliases(
  modes: ReadonlyArray<AcpSessionMode>,
  aliases: ReadonlyArray<string>,
): AcpSessionMode | undefined {
  const normalizedAliases = aliases.map((alias) => alias.toLowerCase());
  for (const alias of normalizedAliases) {
    const exact = modes.find((mode) => {
      const id = mode.id.toLowerCase();
      const name = mode.name.toLowerCase();
      return id === alias || name === alias;
    });
    if (exact) return exact;
  }
  for (const alias of normalizedAliases) {
    const partial = modes.find((mode) => normalizeModeSearchText(mode).includes(alias));
    if (partial) return partial;
  }
  return undefined;
}

function resolveRequestedModeId(input: {
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly runtimeMode: RuntimeMode;
  readonly modeState: AcpSessionModeState | undefined;
}): string | undefined {
  const modeState = input.modeState;
  if (!modeState) return undefined;
  if (input.interactionMode === "plan") {
    return findModeByAliases(modeState.availableModes, ACP_PLAN_MODE_ALIASES)?.id;
  }
  const firstAliases =
    input.runtimeMode === "approval-required"
      ? ACP_APPROVAL_MODE_ALIASES
      : ACP_IMPLEMENT_MODE_ALIASES;
  const secondAliases =
    input.runtimeMode === "approval-required"
      ? ACP_IMPLEMENT_MODE_ALIASES
      : ACP_APPROVAL_MODE_ALIASES;
  return (
    findModeByAliases(modeState.availableModes, firstAliases)?.id ??
    findModeByAliases(modeState.availableModes, secondAliases)?.id ??
    modeState.availableModes.find(
      (mode) => findModeByAliases([mode], ACP_PLAN_MODE_ALIASES) === undefined,
    )?.id ??
    modeState.currentModeId
  );
}

export function applyRequestedGrokSessionConfiguration<E>(input: {
  readonly runtime: AcpSessionRuntimeShape;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly modelSelection:
    | { readonly model: string; readonly options?: GrokModelOptions | null | undefined }
    | undefined;
  readonly mapError: (context: {
    readonly cause: import("effect-acp/errors").AcpError;
    readonly method: "session/set_config_option" | "session/set_mode";
  }) => E;
}): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    if (input.modelSelection) {
      yield* applyGrokAcpModelSelection({
        runtime: input.runtime,
        model: input.modelSelection.model,
        options: input.modelSelection.options,
        mapError: ({ cause, method }) => input.mapError({ cause, method }),
      });
    }
    const requestedModeId = resolveRequestedModeId({
      interactionMode: input.interactionMode,
      runtimeMode: input.runtimeMode,
      modeState: yield* input.runtime.getModeState,
    });
    if (requestedModeId) {
      yield* input.runtime
        .setMode(requestedModeId)
        .pipe(Effect.mapError((cause) => input.mapError({ cause, method: "session/set_mode" })));
    }
  });
}

export function resolveGrokSessionCwd(
  inputCwd: string | undefined,
  serverConfig: ServerConfigShape,
): string | undefined {
  const requestedCwd = inputCwd?.trim();
  if (requestedCwd) return nodePath.resolve(requestedCwd);
  const fallbackCwd = serverConfig.cwd.trim() || serverConfig.homeDir.trim();
  return fallbackCwd ? nodePath.resolve(fallbackCwd) : undefined;
}
