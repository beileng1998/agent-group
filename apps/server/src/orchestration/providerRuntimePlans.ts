import {
  CommandId,
  type OrchestrationProposedPlanId,
  type OrchestrationThread,
  type ProviderRuntimeEvent,
  type ThreadId,
  type TurnId,
} from "@agent-group/contracts";
import { Effect, Option } from "effect";

import type { ProviderServiceShape } from "../provider/Services/ProviderService.ts";
import type { ProjectionTurnRepositoryShape } from "../persistence/Services/ProjectionTurns.ts";
import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine.ts";
import type { makeProviderRuntimeBuffers } from "./providerRuntimeBuffers.ts";
import {
  normalizeProposedPlanMarkdown,
  providerCommandId,
  sameId,
} from "./providerRuntimeIngestionValues.ts";

type Buffers = ReturnType<typeof makeProviderRuntimeBuffers>;

export function makeProviderRuntimePlans(input: {
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly projectionTurnRepository: ProjectionTurnRepositoryShape;
  readonly providerService: ProviderServiceShape;
  readonly getThreadDetail: (threadId: ThreadId) => Effect.Effect<OrchestrationThread | undefined>;
  readonly buffers: Buffers;
}) {
  const upsertProposedPlan = (params: {
    readonly event: ProviderRuntimeEvent;
    readonly threadId: ThreadId;
    readonly threadProposedPlans: OrchestrationThread["proposedPlans"];
    readonly planId: string;
    readonly turnId?: TurnId;
    readonly planMarkdown: string | undefined;
    readonly createdAt: string;
    readonly updatedAt: string;
  }) =>
    Effect.gen(function* () {
      const planMarkdown = normalizeProposedPlanMarkdown(params.planMarkdown);
      if (!planMarkdown) return;
      const existingPlan = params.threadProposedPlans.find((entry) => entry.id === params.planId);
      yield* input.orchestrationEngine.dispatch({
        type: "thread.proposed-plan.upsert",
        commandId: providerCommandId(params.event, "proposed-plan-upsert"),
        threadId: params.threadId,
        proposedPlan: {
          id: params.planId,
          turnId: params.turnId ?? null,
          planMarkdown,
          implementedAt: existingPlan?.implementedAt ?? null,
          implementationThreadId: existingPlan?.implementationThreadId ?? null,
          createdAt: existingPlan?.createdAt ?? params.createdAt,
          updatedAt: params.updatedAt,
        },
        createdAt: params.updatedAt,
      });
    });

  const finalizeBufferedProposedPlan = (params: {
    readonly event: ProviderRuntimeEvent;
    readonly threadId: ThreadId;
    readonly threadProposedPlans: OrchestrationThread["proposedPlans"];
    readonly planId: string;
    readonly turnId?: TurnId;
    readonly fallbackMarkdown?: string;
    readonly updatedAt: string;
  }) =>
    Effect.gen(function* () {
      const bufferedPlan = yield* input.buffers.takeBufferedProposedPlan(params.planId);
      const planMarkdown =
        normalizeProposedPlanMarkdown(bufferedPlan?.text) ??
        normalizeProposedPlanMarkdown(params.fallbackMarkdown);
      if (!planMarkdown) return;
      yield* upsertProposedPlan({
        ...params,
        planMarkdown,
        createdAt:
          bufferedPlan?.createdAt && bufferedPlan.createdAt.length > 0
            ? bufferedPlan.createdAt
            : params.updatedAt,
      });
      yield* input.buffers.clearBufferedProposedPlan(params.planId);
    });

  const getSourceProposedPlanReferenceForPendingTurnStart = Effect.fnUntraced(function* (
    threadId: ThreadId,
  ) {
    const pending = yield* input.projectionTurnRepository.getPendingTurnStartByThreadId({
      threadId,
    });
    if (Option.isNone(pending)) return null;
    const sourceThreadId = pending.value.sourceProposedPlanThreadId;
    const sourcePlanId = pending.value.sourceProposedPlanId;
    return sourceThreadId === null || sourcePlanId === null
      ? null
      : ({ sourceThreadId, sourcePlanId } as const);
  });

  const getSourceProposedPlanReferenceForAcceptedTurnStart = Effect.fnUntraced(function* (
    threadId: ThreadId,
    eventTurnId: TurnId | undefined,
  ) {
    if (eventTurnId === undefined) return null;
    const sessions = yield* input.providerService.listSessions();
    const expectedTurnId = sessions.find((entry) => entry.threadId === threadId)?.activeTurnId;
    if (!sameId(expectedTurnId, eventTurnId)) return null;
    return yield* getSourceProposedPlanReferenceForPendingTurnStart(threadId);
  });

  const markSourceProposedPlanImplemented = Effect.fnUntraced(function* (
    sourceThreadId: ThreadId,
    sourcePlanId: OrchestrationProposedPlanId,
    implementationThreadId: ThreadId,
    implementedAt: string,
  ) {
    const sourceThread = yield* input.getThreadDetail(sourceThreadId);
    const sourcePlan = sourceThread?.proposedPlans.find((entry) => entry.id === sourcePlanId);
    if (!sourceThread || !sourcePlan || sourcePlan.implementedAt !== null) return;
    yield* input.orchestrationEngine.dispatch({
      type: "thread.proposed-plan.upsert",
      commandId: CommandId.makeUnsafe(
        `provider:source-proposed-plan-implemented:${implementationThreadId}:${crypto.randomUUID()}`,
      ),
      threadId: sourceThread.id,
      proposedPlan: {
        ...sourcePlan,
        implementedAt,
        implementationThreadId,
        updatedAt: implementedAt,
      },
      createdAt: implementedAt,
    });
  });

  return {
    finalizeBufferedProposedPlan,
    getSourceProposedPlanReferenceForAcceptedTurnStart,
    markSourceProposedPlanImplemented,
  };
}
