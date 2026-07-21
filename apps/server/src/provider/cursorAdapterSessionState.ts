import * as nodePath from "node:path";

import {
  type CursorModelOptions,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderSession,
  type ProviderUserInputAnswers,
  type RuntimeMode,
  type ThreadId,
  type TurnId,
  type ApprovalRequestId,
} from "@agent-group/contracts";
import { Deferred, Effect, Fiber, Scope } from "effect";
import type * as EffectAcpSchema from "effect-acp/schema";

import type { ServerConfigShape } from "../config.ts";
import { NATIVE_PLAN_MODE_PROMPT } from "./planMode.ts";
import type { AcpSessionRuntimeShape } from "./acp/AcpSessionRuntime.ts";
import type { AcpSessionMode, AcpSessionModeState } from "./acp/AcpRuntimeModel.ts";
import { applyCursorAcpModelSelection } from "./acp/CursorAcpSupport.ts";

export const CURSOR_RESUME_VERSION = 1 as const;
const ACP_PLAN_MODE_ALIASES = ["plan", "architect"];
const ACP_IMPLEMENT_MODE_ALIASES = ["code", "agent", "default", "chat", "implement"];
const ACP_APPROVAL_MODE_ALIASES = ["ask"];

export interface PendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
  readonly kind: string | "unknown";
}

export interface PendingUserInput {
  readonly answers: Deferred.Deferred<ProviderUserInputAnswers>;
}

export interface CursorSessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  readonly scope: Scope.Closeable;
  readonly acp: AcpSessionRuntimeShape;
  notificationFiber: Fiber.Fiber<void, never> | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  readonly assistantItemTurnIds: Map<string, TurnId>;
  lastPlanFingerprint: string | undefined;
  completedPlanFingerprint: string | undefined;
  activeInteractionMode: ProviderInteractionMode | undefined;
  activeTurnId: TurnId | undefined;
  activeTurnFailedToolDetail: string | undefined;
  activePromptFiber: Fiber.Fiber<void, never> | undefined;
  lastTurnActivityAt: number | undefined;
  latestSessionCostUsd: number | undefined;
  stopped: boolean;
}

export function clearCursorActiveTurn(ctx: CursorSessionContext, turnId: TurnId): boolean {
  if (ctx.activeTurnId !== turnId) return false;
  ctx.activeTurnId = undefined;
  ctx.activeTurnFailedToolDetail = undefined;
  ctx.activePromptFiber = undefined;
  ctx.activeInteractionMode = undefined;
  const { activeTurnId: _activeTurnId, ...session } = ctx.session;
  ctx.session = session;
  return true;
}

export function resolveCursorAssistantItemTurnId(
  ctx: CursorSessionContext,
  itemId: string | undefined,
): TurnId | undefined {
  if (itemId === undefined) return ctx.activeTurnId;
  const knownTurnId = ctx.assistantItemTurnIds.get(itemId);
  if (knownTurnId !== undefined) return knownTurnId;
  if (ctx.activeTurnId !== undefined) {
    ctx.assistantItemTurnIds.set(itemId, ctx.activeTurnId);
    return ctx.activeTurnId;
  }
  return ctx.assistantItemTurnIds.get(itemId);
}

export function completeCursorAssistantItemTurnId(
  ctx: CursorSessionContext,
  itemId: string,
): TurnId | undefined {
  const turnId = resolveCursorAssistantItemTurnId(ctx, itemId);
  ctx.assistantItemTurnIds.delete(itemId);
  return turnId;
}

export function recordCursorSessionCost(
  ctx: CursorSessionContext,
  cost: EffectAcpSchema.Cost | null | undefined,
): void {
  if (!cost || cost.currency.toUpperCase() !== "USD" || !Number.isFinite(cost.amount)) return;
  if (cost.amount >= 0) ctx.latestSessionCostUsd = cost.amount;
}

export function finalizeCursorActiveTurnCost(ctx: CursorSessionContext): {
  readonly cumulativeCostUsd?: number;
} {
  return ctx.latestSessionCostUsd !== undefined
    ? { cumulativeCostUsd: ctx.latestSessionCostUsd }
    : {};
}

export function settlePendingApprovalsAsCancelled(
  pendingApprovals: ReadonlyMap<ApprovalRequestId, PendingApproval>,
): Effect.Effect<void> {
  return Effect.forEach(
    Array.from(pendingApprovals.values()),
    (pending) => Deferred.succeed(pending.decision, "cancel").pipe(Effect.ignore),
    { discard: true },
  );
}

export function settlePendingUserInputsAsEmptyAnswers(
  pendingUserInputs: ReadonlyMap<ApprovalRequestId, PendingUserInput>,
): Effect.Effect<void> {
  return Effect.forEach(
    Array.from(pendingUserInputs.values()),
    (pending) => Deferred.succeed(pending.answers, {}).pipe(Effect.ignore),
    { discard: true },
  );
}

export function withCursorPlanModePrompt(input: {
  readonly text: string;
  readonly interactionMode?: ProviderInteractionMode;
}): string {
  if (input.interactionMode !== "plan") return input.text;
  const text = input.text.trim();
  return text.length > 0
    ? `${NATIVE_PLAN_MODE_PROMPT}\n\nUser request:\n${text}`
    : NATIVE_PLAN_MODE_PROMPT;
}

export function parseCursorResume(raw: unknown): { sessionId: string } | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== CURSOR_RESUME_VERSION) return undefined;
  if (typeof record.sessionId !== "string" || !record.sessionId.trim()) return undefined;
  return { sessionId: record.sessionId.trim() };
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
  const aliases =
    input.runtimeMode === "approval-required"
      ? ([ACP_APPROVAL_MODE_ALIASES, ACP_IMPLEMENT_MODE_ALIASES] as const)
      : ([ACP_IMPLEMENT_MODE_ALIASES, ACP_APPROVAL_MODE_ALIASES] as const);
  return (
    findModeByAliases(modeState.availableModes, aliases[0])?.id ??
    findModeByAliases(modeState.availableModes, aliases[1])?.id ??
    modeState.availableModes.find(
      (mode) => findModeByAliases([mode], ACP_PLAN_MODE_ALIASES) === undefined,
    )?.id ??
    modeState.currentModeId
  );
}

export function applyRequestedCursorSessionConfiguration<E>(input: {
  readonly runtime: AcpSessionRuntimeShape;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly modelSelection:
    | { readonly model: string; readonly options?: CursorModelOptions | null | undefined }
    | undefined;
  readonly mapError: (context: {
    readonly cause: import("effect-acp/errors").AcpError;
    readonly method: "session/set_config_option" | "session/set_mode";
  }) => E;
}): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    if (input.modelSelection) {
      yield* applyCursorAcpModelSelection({
        runtime: input.runtime,
        model: input.modelSelection.model,
        options: input.modelSelection.options,
        mapError: ({ cause }) => input.mapError({ cause, method: "session/set_config_option" }),
      });
    }
    const requestedModeId = resolveRequestedModeId({
      interactionMode: input.interactionMode,
      runtimeMode: input.runtimeMode,
      modeState: yield* input.runtime.getModeState,
    });
    if (!requestedModeId) return;
    yield* input.runtime
      .setMode(requestedModeId)
      .pipe(Effect.mapError((cause) => input.mapError({ cause, method: "session/set_mode" })));
  });
}

export function resolveCursorSessionCwd(
  inputCwd: string | undefined,
  serverConfig: ServerConfigShape,
): string | undefined {
  const requestedCwd = inputCwd?.trim();
  if (requestedCwd) return nodePath.resolve(requestedCwd);
  const fallbackCwd = serverConfig.cwd.trim() || serverConfig.homeDir.trim();
  return fallbackCwd ? nodePath.resolve(fallbackCwd) : undefined;
}
