import { Schema } from "effect";
import { TrimmedNonEmptyString } from "../baseSchemas";

export const TrimmedNonEmptyStringSchema = TrimmedNonEmptyString;

export const GitStackedAction = Schema.Literals([
  "commit",
  "push",
  "create_pr",
  "commit_push",
  "commit_push_pr",
]);
export type GitStackedAction = typeof GitStackedAction.Type;

export const GitActionProgressPhase = Schema.Literals(["branch", "commit", "push", "pr"]);
export type GitActionProgressPhase = typeof GitActionProgressPhase.Type;

export const GitActionProgressKind = Schema.Literals([
  "action_started",
  "phase_started",
  "hook_started",
  "hook_output",
  "hook_finished",
  "action_finished",
  "action_failed",
]);
export type GitActionProgressKind = typeof GitActionProgressKind.Type;

export const GitActionProgressStream = Schema.Literals(["stdout", "stderr"]);
export type GitActionProgressStream = typeof GitActionProgressStream.Type;

export const GitCommitStepStatus = Schema.Literals([
  "created",
  "skipped_no_changes",
  "skipped_not_requested",
]);
export const GitPushStepStatus = Schema.Literals([
  "pushed",
  "skipped_not_requested",
  "skipped_up_to_date",
]);
export const GitBranchStepStatus = Schema.Literals(["created", "skipped_not_requested"]);
export const GitPrStepStatus = Schema.Literals([
  "created",
  "opened_existing",
  "skipped_not_requested",
]);
export const GitStatusPrState = Schema.Literals(["open", "closed", "merged"]);
export const GitPullRequestReference = TrimmedNonEmptyStringSchema;
export const GitPullRequestState = Schema.Literals(["open", "closed", "merged"]);

// GitHub's mergeability is eventually consistent: "unknown" is a real transient state
// while GitHub recomputes after a push, not a decode fallback to branch on.
export const GitPullRequestMergeability = Schema.Literals(["mergeable", "conflicting", "unknown"]);
export type GitPullRequestMergeability = typeof GitPullRequestMergeability.Type;

export const GitPreparePullRequestThreadMode = Schema.Literals(["local", "worktree"]);
export const GitHandoffThreadMode = Schema.Literals(["local", "worktree"]);

export const GitBranch = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  isRemote: Schema.optional(Schema.Boolean),
  remoteName: Schema.optional(TrimmedNonEmptyStringSchema),
  current: Schema.Boolean,
  isDefault: Schema.Boolean,
  worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
export type GitBranch = typeof GitBranch.Type;

export const GitWorktree = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
});

export const GitDetachedWorktree = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  ref: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
