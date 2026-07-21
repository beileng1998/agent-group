import { Option, Schema } from "effect";
import { DEFAULT_GIT_TEXT_GENERATION_MODEL } from "../model";
import { ModelSelection, ProviderStartOptions } from "../orchestration";
import { TrimmedNonEmptyStringSchema } from "./domain";

export const GitReadWorkingTreeDiffInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  scope: Schema.optional(Schema.Literals(["workingTree", "unstaged", "staged", "branch"])).pipe(
    Schema.withConstructorDefault(() => Option.some("workingTree" as const)),
  ),
});
export type GitReadWorkingTreeDiffInput = typeof GitReadWorkingTreeDiffInput.Type;

// Read-only diff summary requests reuse the shared git text-generation model settings.
export const GitSummarizeDiffInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  patch: Schema.String,
  codexHomePath: Schema.optional(TrimmedNonEmptyStringSchema),
  providerOptions: Schema.optional(ProviderStartOptions),
  textGenerationModel: Schema.optional(TrimmedNonEmptyStringSchema).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_GIT_TEXT_GENERATION_MODEL)),
  ),
  textGenerationModelSelection: Schema.optional(ModelSelection),
});
export type GitSummarizeDiffInput = typeof GitSummarizeDiffInput.Type;

export const GitStageFilesInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  paths: Schema.Array(TrimmedNonEmptyStringSchema).check(Schema.isMinLength(1)),
});
export type GitStageFilesInput = typeof GitStageFilesInput.Type;

export const GitUnstageFilesInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  paths: Schema.Array(TrimmedNonEmptyStringSchema).check(Schema.isMinLength(1)),
});
export type GitUnstageFilesInput = typeof GitUnstageFilesInput.Type;

export const GitReadWorkingTreeDiffResult = Schema.Struct({
  patch: Schema.String,
});
export type GitReadWorkingTreeDiffResult = typeof GitReadWorkingTreeDiffResult.Type;

// Stage/unstage are fire-and-forget index mutations; callers refetch status/diff.
export const GitStageFilesResult = Schema.Struct({
  ok: Schema.Boolean,
});
export type GitStageFilesResult = typeof GitStageFilesResult.Type;

export const GitUnstageFilesResult = GitStageFilesResult;
export type GitUnstageFilesResult = GitStageFilesResult;

export const GitSummarizeDiffResult = Schema.Struct({
  summary: TrimmedNonEmptyStringSchema,
});
export type GitSummarizeDiffResult = typeof GitSummarizeDiffResult.Type;
