import type {
  AutomationCompletionPolicy,
  AutomationDefinition,
  AutomationRun,
  AutomationRunResult,
} from "@agent-group/contracts";
import { Effect, Option } from "effect";

import { resolveTextGenerationInputForSelection } from "../../../git/textGenerationSelection.ts";
import { AutomationServiceError } from "../../Errors.ts";
import {
  type AutomationCompletionEvaluation,
  automationCompletionRunResult,
  failedAutomationCompletionEvaluation,
  normalizeAutomationCompletionReason,
} from "../../runResult.ts";
import {
  completionPolicyForDefinition,
  isSameAiCompletionPolicy,
} from "./automationDefinitionPolicy.ts";
import type {
  AutomationRuntimeDependencies,
  PublishAutomationDefinition,
  PublishAutomationEvent,
  RequireAutomationProject,
} from "./automationServiceTypes.ts";
import { errorMessage, isoNow, toServiceError } from "./automationServiceValues.ts";

const AUTOMATION_COMPLETION_EVALUATION_TIMEOUT_MS = 30_000;

function completionFailureReason(error: unknown): string {
  const message = error instanceof AutomationServiceError ? error.message : errorMessage(error);
  return normalizeAutomationCompletionReason(`Stop check failed: ${message}`);
}

function findRunCompletionMessages(input: {
  readonly run: AutomationRun;
  readonly thread: {
    readonly messages: ReadonlyArray<{
      readonly id: string;
      readonly role: string;
      readonly text: string;
      readonly turnId: string | null;
    }>;
  };
}) {
  const runMessages = input.thread.messages.filter(
    (message) =>
      message.id === input.run.messageId ||
      (input.run.turnId !== null && message.turnId === input.run.turnId),
  );
  const userMessage =
    input.thread.messages.find((message) => message.id === input.run.messageId)?.text ?? "";
  const assistantMessages = runMessages.filter((message) => message.role === "assistant");
  return {
    runUserMessage: userMessage,
    runAssistantText:
      assistantMessages.length > 0
        ? assistantMessages.map((message) => message.text).join("\n\n")
        : "",
    runThreadContext: runMessages
      .slice(-8)
      .map((message) => `${message.role}: ${message.text}`)
      .join("\n\n"),
  };
}

function staleStopCheckEvaluation(rawEvaluation: AutomationCompletionEvaluation) {
  return {
    ...rawEvaluation,
    stopMatched: false,
    reason: normalizeAutomationCompletionReason(
      "Stop check ignored because the automation changed before evaluation finished.",
    ),
  };
}

export function makeAutomationCompletionEvaluator(input: {
  readonly dependencies: AutomationRuntimeDependencies;
  readonly publish: PublishAutomationEvent;
  readonly publishDefinition: PublishAutomationDefinition;
  readonly requireProject: RequireAutomationProject;
}) {
  const { automationRepository, projectionSnapshotQuery, textGeneration, serverSettings } =
    input.dependencies;
  const { publish, publishDefinition, requireProject } = input;

  const latestRunForCompletionResult = (run: AutomationRun) =>
    automationRepository.getRunById({ id: run.id }).pipe(
      Effect.mapError(toServiceError("Failed to load automation run.")),
      Effect.map((runOption) =>
        Option.match(runOption, { onNone: () => run, onSome: (latest) => latest }),
      ),
    );

  const recordCompletionEvaluation = (recordInput: {
    readonly run: AutomationRun;
    readonly evaluation: AutomationCompletionEvaluation;
    readonly matched: boolean;
    readonly summary?: string;
    readonly severity?: NonNullable<AutomationRunResult["severity"]>;
  }) =>
    Effect.gen(function* () {
      const latestRun = yield* latestRunForCompletionResult(recordInput.run);
      const updatedAt = isoNow();
      const updated = yield* automationRepository
        .markRunCompletionResult({
          id: latestRun.id,
          result: automationCompletionRunResult({
            baseResult: latestRun.result,
            evaluation: recordInput.evaluation,
            matched: recordInput.matched,
            ...(recordInput.summary !== undefined ? { summary: recordInput.summary } : {}),
            ...(recordInput.severity ? { severity: recordInput.severity } : {}),
          }),
          updatedAt,
        })
        .pipe(Effect.mapError(toServiceError("Failed to update automation run result.")));
      yield* publish({ type: "run-upserted", run: updated });
      return updated;
    });

  const resolveTextGenerationInput = (definition: AutomationDefinition) =>
    Effect.gen(function* () {
      const directInput = resolveTextGenerationInputForSelection(
        definition.modelSelection,
        definition.providerOptions,
      );
      if (directInput) return directInput;
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError(toServiceError("Failed to load text-generation settings.")),
      );
      return (
        resolveTextGenerationInputForSelection(
          settings.textGenerationModelSelection,
          definition.providerOptions,
        ) ?? {}
      );
    });

  const shouldUseStopPolicyForDefinition = (
    definition: AutomationDefinition,
    policy: Extract<AutomationCompletionPolicy, { type: "ai-evaluated" }>,
  ): boolean => {
    const currentPolicy = completionPolicyForDefinition(definition);
    return (
      definition.mode === "heartbeat" &&
      definition.enabled &&
      definition.archivedAt === null &&
      currentPolicy.type === "ai-evaluated" &&
      isSameAiCompletionPolicy(currentPolicy, policy)
    );
  };

  const loadCurrentStopDefinition = (
    definition: AutomationDefinition,
    policy: Extract<AutomationCompletionPolicy, { type: "ai-evaluated" }>,
  ) =>
    automationRepository.getDefinitionById({ id: definition.id }).pipe(
      Effect.mapError(toServiceError("Failed to load automation.")),
      Effect.map((definitionOption) =>
        Option.match(definitionOption, {
          onNone: () => Option.none<AutomationDefinition>(),
          onSome: (current) =>
            current.updatedAt === definition.updatedAt &&
            shouldUseStopPolicyForDefinition(current, policy)
              ? Option.some(current)
              : Option.none<AutomationDefinition>(),
        }),
      ),
    );

  const evaluateCompletionPolicy = (
    definition: AutomationDefinition,
    run: AutomationRun,
    policy: Extract<AutomationCompletionPolicy, { type: "ai-evaluated" }>,
  ) =>
    Effect.gen(function* () {
      if (!run.threadId) {
        const reason = "Stop check skipped because the automation run has no target thread.";
        yield* recordCompletionEvaluation({
          run,
          evaluation: failedAutomationCompletionEvaluation(reason),
          matched: false,
          summary: reason,
          severity: "warning",
        });
        return false;
      }
      const project = yield* requireProject(definition.projectId);
      const threadOption = yield* projectionSnapshotQuery
        .getThreadDetailById(run.threadId)
        .pipe(Effect.mapError(toServiceError("Failed to load automation thread detail.")));
      if (Option.isNone(threadOption)) {
        const reason = "Stop check skipped because the target thread could not be found.";
        yield* recordCompletionEvaluation({
          run,
          evaluation: failedAutomationCompletionEvaluation(reason),
          matched: false,
          summary: reason,
          severity: "warning",
        });
        return false;
      }
      const { runUserMessage, runAssistantText, runThreadContext } = findRunCompletionMessages({
        run,
        thread: threadOption.value,
      });
      const textGenerationInput = yield* resolveTextGenerationInput(definition);
      const evaluationOption = yield* textGeneration
        .evaluateAutomationCompletion({
          cwd: project.workspaceRoot,
          automationName: definition.name,
          automationPrompt: definition.prompt,
          stopWhen: policy.stopWhen,
          runUserMessage: runUserMessage || definition.prompt,
          runAssistantText: runAssistantText || "(no assistant output)",
          threadContext: runThreadContext || "(no run-scoped thread context)",
          ...textGenerationInput,
        })
        .pipe(
          Effect.mapError(toServiceError("Failed to evaluate automation stop condition.")),
          Effect.timeoutOption(AUTOMATION_COMPLETION_EVALUATION_TIMEOUT_MS),
        );
      if (Option.isNone(evaluationOption)) {
        const reason = normalizeAutomationCompletionReason("Stop check timed out.");
        const timedOut = failedAutomationCompletionEvaluation(reason);
        const stillCurrent = Option.isSome(yield* loadCurrentStopDefinition(definition, policy));
        yield* recordCompletionEvaluation(
          stillCurrent
            ? { run, evaluation: timedOut, matched: false, summary: reason, severity: "warning" }
            : { run, evaluation: staleStopCheckEvaluation(timedOut), matched: false },
        );
        return false;
      }
      const evaluationRaw = evaluationOption.value;
      const rawEvaluation = {
        stopMatched: evaluationRaw.stopMatched,
        confidence: Math.max(0, Math.min(1, evaluationRaw.confidence)),
        reason: normalizeAutomationCompletionReason(evaluationRaw.reason),
      };
      const currentDefinitionOption = yield* loadCurrentStopDefinition(definition, policy);
      const policyStillCurrent = Option.isSome(currentDefinitionOption);
      const evaluation: AutomationCompletionEvaluation = policyStillCurrent
        ? rawEvaluation
        : staleStopCheckEvaluation(rawEvaluation);
      const matched =
        policyStillCurrent &&
        evaluation.stopMatched &&
        evaluation.confidence >= policy.confidenceThreshold;
      if (!matched) {
        yield* recordCompletionEvaluation({ run, evaluation, matched: false });
        return false;
      }
      const currentDefinition = Option.getOrThrow(currentDefinitionOption);
      const disabled = yield* automationRepository
        .disableDefinitionIfUnchanged({
          id: currentDefinition.id,
          expectedUpdatedAt: currentDefinition.updatedAt,
          now: isoNow(),
        })
        .pipe(Effect.mapError(toServiceError("Failed to disable automation.")));
      if (!disabled) {
        yield* recordCompletionEvaluation({
          run,
          evaluation: staleStopCheckEvaluation(rawEvaluation),
          matched: false,
        });
        return false;
      }
      yield* publishDefinition(currentDefinition.id);
      yield* recordCompletionEvaluation({ run, evaluation, matched: true });
      return true;
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const reason = completionFailureReason(error);
          yield* Effect.logWarning("automation completion evaluation failed", {
            automationId: definition.id,
            runId: run.id,
            error: errorMessage(error),
          });
          yield* recordCompletionEvaluation({
            run,
            evaluation: failedAutomationCompletionEvaluation(reason),
            matched: false,
            summary: reason,
            severity: "warning",
          }).pipe(
            Effect.catch((recordError) =>
              Effect.logWarning("automation completion evaluation failure could not be recorded", {
                automationId: definition.id,
                runId: run.id,
                error: errorMessage(recordError),
              }),
            ),
          );
          return false;
        }),
      ),
    );

  return { evaluateCompletionPolicy, shouldUseStopPolicyForDefinition };
}
