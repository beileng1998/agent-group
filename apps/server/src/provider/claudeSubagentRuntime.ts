import type { ProviderRuntimeTurnStatus } from "@agent-group/contracts";
import { Effect } from "effect";

import type { ClaudeSessionContext, ClaudeSubagentRun } from "./claudeAdapterRuntime.ts";
import {
  claudeSubagentTurnStatus,
  ClaudeSubagentRouteRegistry,
  type ClaudeSubagentRouteLookup,
  type ClaudeSubagentTerminalStatus,
} from "./claudeSubagentRouting.ts";

export function makeClaudeSubagentRuntime(input: {
  readonly completeTurn: (
    context: ClaudeSessionContext,
    status: ProviderRuntimeTurnStatus,
    errorMessage?: string,
  ) => Effect.Effect<void>;
}) {
  const ensureRun = (
    context: ClaudeSessionContext,
    toolUseId: string,
  ): ClaudeSubagentRun | undefined => {
    if (!context.subagentRoutes.registerToolUse(toolUseId)) {
      return undefined;
    }

    const existing = context.subagentRuns.get(toolUseId);
    if (existing) {
      return existing;
    }

    const run: ClaudeSubagentRun = {
      toolUseId,
      context: {
        session: context.session,
        promptQueue: context.promptQueue,
        query: context.query,
        modelDiscoveryKey: context.modelDiscoveryKey,
        streamFiber: undefined,
        startedAt: context.startedAt,
        basePermissionMode: context.basePermissionMode,
        lastInteractionMode: undefined,
        currentApiModelId: undefined,
        resumeSessionId: undefined,
        pendingApprovals: new Map(),
        pendingUserInputs: new Map(),
        turns: [],
        inFlightTools: new Map(),
        trackedTasks: new Map(),
        turnState: undefined,
        interruptRequestedTurnId: undefined,
        lastKnownContextWindow: context.lastKnownContextWindow,
        currentAutoCompactWindow: context.currentAutoCompactWindow,
        lastKnownAutoCompactThreshold: context.lastKnownAutoCompactThreshold,
        contextUsageControlEnabled: false,
        lastKnownTokenUsage: undefined,
        lastAssistantUuid: undefined,
        lastThreadStartedId: undefined,
        rerouteOriginalApiModelId: undefined,
        emittedContextUsageWarnings: new Set(),
        stopped: false,
        warnedUnhandledSdkKinds: context.warnedUnhandledSdkKinds,
        subagentRoutes: new ClaudeSubagentRouteRegistry(),
        subagentRuns: new Map(),
        subagentRefs: {
          providerThreadId: toolUseId,
          providerParentThreadId: String(context.session.threadId),
        },
      },
    };
    context.subagentRuns.set(toolUseId, run);
    return run;
  };

  const runForTask = (
    context: ClaudeSessionContext,
    lookup: ClaudeSubagentRouteLookup,
    options?: { readonly includeSettled?: boolean },
  ): ClaudeSubagentRun | undefined => {
    const route = options?.includeSettled
      ? context.subagentRoutes.resolve(lookup)
      : context.subagentRoutes.resolveActive(lookup);
    return route ? context.subagentRuns.get(route.toolUseId) : undefined;
  };

  const settleRun = (
    context: ClaudeSessionContext,
    lookup: ClaudeSubagentRouteLookup,
    status: ClaudeSubagentTerminalStatus,
    errorMessage?: string,
    options?: { readonly retainRun?: boolean },
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const route = context.subagentRoutes.resolve(lookup);
      const run = route ? context.subagentRuns.get(route.toolUseId) : undefined;
      const settlement = context.subagentRoutes.settle(lookup, status);
      if (!settlement) {
        if (options?.retainRun !== true && route && context.subagentRoutes.settledStatus(lookup)) {
          context.subagentRuns.delete(route.toolUseId);
        }
        return;
      }

      if (options?.retainRun !== true) {
        context.subagentRuns.delete(settlement.route.toolUseId);
      }
      if (run?.context.turnState) {
        yield* input.completeTurn(run.context, claudeSubagentTurnStatus(status), errorMessage);
      }
    });

  return {
    ensureRun,
    runForTask,
    settleRun,
  };
}
