import * as nodePath from "node:path";

import {
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderSession,
  type ProviderUserInputAnswers,
  type ThreadId,
  type TurnId,
} from "@agent-group/contracts";
import { Deferred, Fiber, Scope } from "effect";
import type * as EffectAcpSchema from "effect-acp/schema";

import type { ServerConfigShape } from "../config.ts";
import { NATIVE_PLAN_MODE_PROMPT } from "./planMode.ts";
import {
  readAcpUsdCost,
  scopeAcpRuntimeItemIdForTurn,
  scopeAcpToolCallStateForTurn,
} from "./acp/AcpAdapterSessionSupport.ts";
import {
  selectAcpFullAccessPermissionOptionId,
  selectAcpPermissionOptionId,
} from "./acp/AcpAdapterSupport.ts";
import type { AcpSessionRuntimeShape } from "./acp/AcpSessionRuntime.ts";
import type { AcpToolCallState } from "./acp/AcpRuntimeModel.ts";

const PROVIDER = "droid" as const;
export const DROID_RESUME_VERSION = 1 as const;

export interface PendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
  readonly kind: string | "unknown";
}

export interface PendingUserInput {
  readonly answers: Deferred.Deferred<ProviderUserInputAnswers>;
}

export interface DroidSessionContext {
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
  readonly activeNestedTaskToolCallIds: Set<string>;
  readonly nestedTaskLifecycleByToolCallId: Map<string, "active" | "completed">;
  resumeReplayReady: Deferred.Deferred<void> | undefined;
  resumeReplayLastSuppressedAt: number | undefined;
  sessionConfigReady: Deferred.Deferred<void> | undefined;
  readonly teardownComplete: Deferred.Deferred<void>;
  latestSessionCostUsd: number | undefined;
  sessionUpdatesProcessed: number;
  turnStarting: boolean;
  pendingTurnInterrupted: boolean;
  stopped: boolean;
}

export function clearDroidActiveTurn(ctx: DroidSessionContext, turnId: TurnId): boolean {
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

export function scopeDroidRuntimeItemIdForTurn(turnId: TurnId, itemId: string): string {
  return scopeAcpRuntimeItemIdForTurn(PROVIDER, turnId, itemId);
}

export function isRenderableDroidAssistantDelta(input: {
  readonly streamKind?: string | undefined;
  readonly text: string;
}): boolean {
  return input.streamKind !== "reasoning_text" && input.text.trim().length > 0;
}

export function isDroidNestedTaskToolCall(toolCall: AcpToolCallState): boolean {
  if (toolCall.title?.trim().toLowerCase() === "task") return true;
  const rawInput = toolCall.data.rawInput;
  return (
    typeof rawInput === "object" &&
    rawInput !== null &&
    "subagent_type" in rawInput &&
    typeof rawInput.subagent_type === "string"
  );
}

export function shouldIgnoreDroidInterrupt(
  requestedTurnId: TurnId | undefined,
  activeTurnId: TurnId | undefined,
): boolean {
  return requestedTurnId !== undefined && requestedTurnId !== activeTurnId;
}

type DroidPermissionPolicyOutcome =
  | { readonly outcome: "selected"; readonly optionId: string }
  | { readonly outcome: "cancelled" };

export function resolveDroidPermissionPolicy(input: {
  readonly runtimeMode: "approval-required" | "full-access";
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly options: ReadonlyArray<Pick<EffectAcpSchema.PermissionOption, "kind" | "optionId">>;
}): DroidPermissionPolicyOutcome | undefined {
  if (input.interactionMode === "plan") {
    const optionId = selectAcpPermissionOptionId("decline", input.options);
    return optionId === undefined ? { outcome: "cancelled" } : { outcome: "selected", optionId };
  }
  if (input.runtimeMode !== "full-access") return undefined;
  const optionId = selectAcpFullAccessPermissionOptionId(input.options);
  return optionId === undefined ? undefined : { outcome: "selected", optionId };
}

export function scopeDroidToolCallStateForTurn(
  turnId: TurnId,
  toolCall: AcpToolCallState,
): AcpToolCallState {
  return scopeAcpToolCallStateForTurn(PROVIDER, turnId, toolCall);
}

export function parseDroidResume(raw: unknown): { sessionId: string } | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== DROID_RESUME_VERSION) return undefined;
  if (typeof record.sessionId !== "string" || !record.sessionId.trim()) return undefined;
  return { sessionId: record.sessionId.trim() };
}

export function recordDroidSessionCost(
  ctx: DroidSessionContext,
  cost: EffectAcpSchema.Cost | null | undefined,
): void {
  const sessionCostUsd = readAcpUsdCost(cost);
  if (sessionCostUsd !== undefined) ctx.latestSessionCostUsd = sessionCostUsd;
}

export function finalizeDroidActiveTurnCost(ctx: DroidSessionContext): {
  readonly cumulativeCostUsd?: number;
} {
  return ctx.latestSessionCostUsd !== undefined
    ? { cumulativeCostUsd: ctx.latestSessionCostUsd }
    : {};
}

export function withDroidPlanModePrompt(input: {
  readonly text: string;
  readonly interactionMode?: ProviderInteractionMode;
}): string {
  if (input.interactionMode !== "plan") return input.text;
  const text = input.text.trim();
  return text.length > 0
    ? `${NATIVE_PLAN_MODE_PROMPT}\n\nUser request:\n${text}`
    : NATIVE_PLAN_MODE_PROMPT;
}

export function resolveDroidSessionCwd(
  inputCwd: string | undefined,
  serverConfig: ServerConfigShape,
  sessionCwd?: string,
): string | undefined {
  const requestedCwd = inputCwd?.trim() || sessionCwd?.trim();
  if (requestedCwd) return nodePath.resolve(requestedCwd);
  const fallbackCwd = serverConfig.cwd.trim() || serverConfig.homeDir.trim();
  return fallbackCwd ? nodePath.resolve(fallbackCwd) : undefined;
}
