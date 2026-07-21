import { Schema } from "effect";
import { TrimmedNonEmptyStringSchema } from "./domain";

export const GitHubRepositoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitHubRepositoryInput = typeof GitHubRepositoryInput.Type;

export const GitHubRepositoryResult = Schema.Struct({
  repository: Schema.NullOr(
    Schema.Struct({
      nameWithOwner: TrimmedNonEmptyStringSchema,
      url: TrimmedNonEmptyStringSchema,
    }),
  ),
  repositories: Schema.Array(
    Schema.Struct({
      nameWithOwner: TrimmedNonEmptyStringSchema,
      url: TrimmedNonEmptyStringSchema,
    }),
  ),
});
export type GitHubRepositoryResult = typeof GitHubRepositoryResult.Type;
