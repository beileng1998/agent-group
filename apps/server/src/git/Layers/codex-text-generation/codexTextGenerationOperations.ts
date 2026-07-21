import { Effect } from "effect";

import { sanitizeGeneratedThreadTitle } from "@agent-group/shared/chatThreads";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@agent-group/shared/git";

import type {
  BranchNameGenerationResult,
  CommitMessageGenerationResult,
  DiffSummaryGenerationResult,
  PrContentGenerationResult,
  TextGenerationShape,
  ThreadRecapGenerationResult,
  ThreadTitleGenerationResult,
} from "../../Services/TextGeneration.ts";
import {
  buildAutomationCompletionEvaluationPrompt,
  buildAutomationIntentPrompt,
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildDiffSummaryPrompt,
  buildPrContentPrompt,
  buildThreadRecapPrompt,
  buildThreadTitlePrompt,
  sanitizeCommitSubject,
  sanitizeDiffSummary,
  sanitizePrTitle,
  sanitizeThreadRecap,
} from "../../textGenerationShared.ts";
import type { CodexTextGenerationRuntime } from "./codexTextGenerationRunner.ts";

export function makeCodexTextGenerationOperations(
  runtime: CodexTextGenerationRuntime,
): TextGenerationShape {
  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = (input) => {
    const wantsBranch = input.includeBranch === true;
    const { prompt, outputSchemaJson } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: wantsBranch,
    });

    return runtime
      .runCodexJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt,
        outputSchemaJson,
        ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
        ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      })
      .pipe(
        Effect.map(
          (generated) =>
            ({
              subject: sanitizeCommitSubject(generated.subject),
              body: generated.body.trim(),
              ...("branch" in generated && typeof generated.branch === "string"
                ? { branch: sanitizeFeatureBranchName(generated.branch) }
                : {}),
            }) satisfies CommitMessageGenerationResult,
        ),
      );
  };

  const generatePrContent: TextGenerationShape["generatePrContent"] = (input) => {
    const { prompt, outputSchemaJson } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    });

    return runtime
      .runCodexJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt,
        outputSchemaJson,
        ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
        ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      })
      .pipe(
        Effect.map(
          (generated) =>
            ({
              title: sanitizePrTitle(generated.title),
              body: generated.body.trim(),
            }) satisfies PrContentGenerationResult,
        ),
      );
  };

  const generateDiffSummary: TextGenerationShape["generateDiffSummary"] = (input) => {
    const { prompt, outputSchemaJson } = buildDiffSummaryPrompt({ patch: input.patch });

    return runtime
      .runCodexJson({
        operation: "generateDiffSummary",
        cwd: input.cwd,
        prompt,
        outputSchemaJson,
        ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
        ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      })
      .pipe(
        Effect.map(
          (generated) =>
            ({
              summary: sanitizeDiffSummary(generated.summary),
            }) satisfies DiffSummaryGenerationResult,
        ),
      );
  };

  const generateBranchName: TextGenerationShape["generateBranchName"] = (input) =>
    Effect.gen(function* () {
      const { imagePaths } = yield* runtime.materializeImageAttachments(
        "generateBranchName",
        input.attachments,
      );
      const { prompt, outputSchemaJson } = buildBranchNamePrompt({
        message: input.message,
        ...(input.attachments ? { attachments: input.attachments } : {}),
      });
      const generated = yield* runtime.runCodexJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson,
        imagePaths,
        ...(input.model ? { model: input.model } : {}),
        ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
        ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      });
      return {
        branch: sanitizeBranchFragment(generated.branch),
      } satisfies BranchNameGenerationResult;
    });

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = (input) =>
    Effect.gen(function* () {
      const { imagePaths } = yield* runtime.materializeImageAttachments(
        "generateThreadTitle",
        input.attachments,
      );
      const { prompt, outputSchemaJson } = buildThreadTitlePrompt({
        message: input.message,
        ...(input.attachments ? { attachments: input.attachments } : {}),
      });
      const generated = yield* runtime.runCodexJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchemaJson,
        imagePaths,
        ...(input.model ? { model: input.model } : {}),
        ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
        ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      });
      return {
        title: sanitizeGeneratedThreadTitle(generated.title),
      } satisfies ThreadTitleGenerationResult;
    });

  const generateThreadRecap: TextGenerationShape["generateThreadRecap"] = (input) => {
    const { prompt, outputSchemaJson } = buildThreadRecapPrompt({
      ...(input.previousRecap ? { previousRecap: input.previousRecap } : {}),
      newMaterial: input.newMaterial,
      ...(input.currentState ? { currentState: input.currentState } : {}),
    });
    return runtime
      .runCodexJson({
        operation: "generateThreadRecap",
        cwd: input.cwd,
        prompt,
        outputSchemaJson,
        ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
        ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      })
      .pipe(
        Effect.map(
          (generated) =>
            ({
              recap: sanitizeThreadRecap(generated.recap, input.previousRecap),
            }) satisfies ThreadRecapGenerationResult,
        ),
      );
  };

  const generateAutomationIntent: TextGenerationShape["generateAutomationIntent"] = (input) => {
    const { prompt, outputSchemaJson } = buildAutomationIntentPrompt({
      message: input.message,
      ...(input.defaultMode ? { defaultMode: input.defaultMode } : {}),
      nowIso: input.nowIso,
    });
    return runtime.runCodexJson({
      operation: "generateAutomationIntent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
      ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
    });
  };

  const evaluateAutomationCompletion: TextGenerationShape["evaluateAutomationCompletion"] = (
    input,
  ) => {
    const { prompt, outputSchemaJson } = buildAutomationCompletionEvaluationPrompt(input);
    return runtime.runCodexJson({
      operation: "evaluateAutomationCompletion",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
      ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
    });
  };

  return {
    generateCommitMessage,
    generatePrContent,
    generateDiffSummary,
    generateBranchName,
    generateThreadTitle,
    generateThreadRecap,
    generateAutomationIntent,
    evaluateAutomationCompletion,
  };
}
