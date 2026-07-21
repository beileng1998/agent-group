import { Schema } from "effect";
import {
  GitBranch,
  GitDetachedWorktree,
  GitHandoffThreadMode,
  GitWorktree,
  TrimmedNonEmptyStringSchema,
} from "./domain";

export const GitPullInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitPullInput = typeof GitPullInput.Type;

export const GitListBranchesInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitListBranchesInput = typeof GitListBranchesInput.Type;

export const GitCreateWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
  newBranch: Schema.optional(TrimmedNonEmptyStringSchema),
  path: Schema.NullOr(TrimmedNonEmptyStringSchema),
});
export type GitCreateWorktreeInput = typeof GitCreateWorktreeInput.Type;

export const GitCreateDetachedWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  ref: TrimmedNonEmptyStringSchema,
  path: Schema.NullOr(TrimmedNonEmptyStringSchema),
});
export type GitCreateDetachedWorktreeInput = typeof GitCreateDetachedWorktreeInput.Type;

export const GitHandoffThreadInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  targetMode: GitHandoffThreadMode,
  currentBranch: Schema.NullOr(TrimmedNonEmptyStringSchema),
  worktreePath: Schema.NullOr(TrimmedNonEmptyStringSchema),
  associatedWorktreePath: Schema.NullOr(TrimmedNonEmptyStringSchema),
  associatedWorktreeBranch: Schema.NullOr(TrimmedNonEmptyStringSchema),
  associatedWorktreeRef: Schema.NullOr(TrimmedNonEmptyStringSchema),
  preferredLocalBranch: Schema.NullOr(TrimmedNonEmptyStringSchema),
  preferredWorktreeBaseBranch: Schema.NullOr(TrimmedNonEmptyStringSchema),
  preferredNewWorktreeName: Schema.NullOr(TrimmedNonEmptyStringSchema),
});
export type GitHandoffThreadInput = typeof GitHandoffThreadInput.Type;

export const GitRemoveWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  path: TrimmedNonEmptyStringSchema,
  force: Schema.optional(Schema.Boolean),
});
export type GitRemoveWorktreeInput = typeof GitRemoveWorktreeInput.Type;

export const GitCreateBranchInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
  publish: Schema.optional(Schema.Boolean),
});
export type GitCreateBranchInput = typeof GitCreateBranchInput.Type;

export const GitCheckoutInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
});
export type GitCheckoutInput = typeof GitCheckoutInput.Type;

export const GitStashAndCheckoutInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
});
export type GitStashAndCheckoutInput = typeof GitStashAndCheckoutInput.Type;

export const GitStashDropInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitStashDropInput = typeof GitStashDropInput.Type;

export const GitStashInfoInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitStashInfoInput = typeof GitStashInfoInput.Type;

export const GitRemoveIndexLockInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitRemoveIndexLockInput = typeof GitRemoveIndexLockInput.Type;

export const GitInitInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitInitInput = typeof GitInitInput.Type;

export const GitListBranchesResult = Schema.Struct({
  branches: Schema.Array(GitBranch),
  isRepo: Schema.Boolean,
  hasOriginRemote: Schema.Boolean,
});
export type GitListBranchesResult = typeof GitListBranchesResult.Type;

export const GitCreateWorktreeResult = Schema.Struct({
  worktree: GitWorktree,
});
export type GitCreateWorktreeResult = typeof GitCreateWorktreeResult.Type;

export const GitCreateDetachedWorktreeResult = Schema.Struct({
  worktree: GitDetachedWorktree,
});
export type GitCreateDetachedWorktreeResult = typeof GitCreateDetachedWorktreeResult.Type;

export const GitStashInfoResult = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  stashRef: TrimmedNonEmptyStringSchema,
  message: TrimmedNonEmptyStringSchema,
  files: Schema.Array(TrimmedNonEmptyStringSchema),
});
export type GitStashInfoResult = typeof GitStashInfoResult.Type;

export const GitHandoffThreadResult = Schema.Struct({
  targetMode: GitHandoffThreadMode,
  branch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  associatedWorktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  associatedWorktreeBranch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  associatedWorktreeRef: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  changesTransferred: Schema.Boolean,
  conflictsDetected: Schema.Boolean,
  message: Schema.NullOr(Schema.String),
});
export type GitHandoffThreadResult = typeof GitHandoffThreadResult.Type;

export const GitPullResult = Schema.Struct({
  status: Schema.Literals(["pulled", "skipped_up_to_date"]),
  branch: TrimmedNonEmptyStringSchema,
  upstreamBranch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
export type GitPullResult = typeof GitPullResult.Type;
