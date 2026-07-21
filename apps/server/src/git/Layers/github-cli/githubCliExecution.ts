import { Effect } from "effect";
import {
  isValidGitHubRepositoryNameWithOwner,
  parseGitHubRepositoryNameWithOwnerFromRemoteUrl,
} from "@agent-group/shared/githubRepository";

import { runProcess } from "../../../processRunner";
import { GitHubCliError } from "../../Errors.ts";
import type { GitHubCliShape } from "../../Services/GitHubCli.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
export const PULL_REQUEST_DIFF_MAX_BYTES = 8 * 1024 * 1024;
export const GITHUB_HOST = "github.com";

function normalizeGitHubCliError(operation: "execute" | "stdout", error: unknown): GitHubCliError {
  if (error instanceof Error) {
    if (error.message.includes("Command not found: gh")) {
      return new GitHubCliError({
        operation,
        detail: "GitHub CLI (`gh`) is required but not available on PATH.",
        reason: "not-installed",
        cause: error,
      });
    }
    const lower = error.message.toLowerCase();
    if (
      lower.includes("authentication failed") ||
      lower.includes("not logged in") ||
      lower.includes("gh auth login") ||
      lower.includes("no oauth token") ||
      lower.includes("bad credentials") ||
      lower.includes("http 401") ||
      lower.includes("401 unauthorized")
    ) {
      return new GitHubCliError({
        operation,
        detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
        reason: "not-authenticated",
        cause: error,
      });
    }
    if (
      lower.includes("could not resolve to a pullrequest") ||
      lower.includes("repository.pullrequest") ||
      lower.includes("no pull requests found for branch") ||
      lower.includes("pull request not found")
    ) {
      return new GitHubCliError({
        operation,
        detail: "Pull request not found. Check the PR number or URL and try again.",
        reason: "other",
        cause: error,
      });
    }
    return new GitHubCliError({
      operation,
      detail: `GitHub CLI command failed: ${error.message}`,
      reason: "other",
      cause: error,
    });
  }
  return new GitHubCliError({
    operation,
    detail: "GitHub CLI command failed.",
    reason: "other",
    cause: error,
  });
}

export type GitHubExecute = GitHubCliShape["execute"];

export function makeGitHubCliExecution() {
  const execute: GitHubExecute = (input) =>
    Effect.tryPromise({
      try: (signal) =>
        runProcess("gh", input.args, {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          signal,
          env: { ...process.env, GH_HOST: GITHUB_HOST },
          ...(input.maxBufferBytes !== undefined ? { maxBufferBytes: input.maxBufferBytes } : {}),
          ...(input.outputMode !== undefined ? { outputMode: input.outputMode } : {}),
          ...(input.stdin !== undefined ? { stdin: input.stdin } : {}),
        }),
      catch: (error) => normalizeGitHubCliError("execute", error),
    });

  const runGit = (gitInput: {
    cwd: string;
    args: readonly string[];
    maxBufferBytes?: number;
    outputMode?: "error" | "truncate";
    timeoutMs?: number;
  }) =>
    Effect.tryPromise({
      try: (signal) =>
        runProcess("git", gitInput.args, {
          cwd: gitInput.cwd,
          timeoutMs: gitInput.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          signal,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          ...(gitInput.maxBufferBytes !== undefined
            ? { maxBufferBytes: gitInput.maxBufferBytes }
            : {}),
          ...(gitInput.outputMode !== undefined ? { outputMode: gitInput.outputMode } : {}),
        }),
      catch: (error) => normalizeGitHubCliError("execute", error),
    });

  const repositoryFromConfiguredRemoteUrl = (remoteUrl: string): string | null => {
    const direct = parseGitHubRepositoryNameWithOwnerFromRemoteUrl(remoteUrl);
    if (direct) return direct;
    try {
      const parsed = new URL(remoteUrl);
      if (!parsed.username && !parsed.password) return null;
      parsed.username = "";
      parsed.password = "";
      return parseGitHubRepositoryNameWithOwnerFromRemoteUrl(parsed.toString());
    } catch {
      return null;
    }
  };

  const resolvePullRequestFetchSource = (cwd: string, repository: string) =>
    runGit({ cwd, args: ["remote", "-v"] }).pipe(
      Effect.map((result) => {
        const target = repository.toLowerCase();
        for (const line of result.stdout.split("\n")) {
          const match = /^(\S+)\t(\S+)\s+\(fetch\)$/.exec(line);
          const remoteName = match?.[1];
          const remoteUrl = match?.[2];
          if (!remoteName || !remoteUrl) continue;
          const parsed = repositoryFromConfiguredRemoteUrl(remoteUrl);
          if (parsed?.toLowerCase() === target && !remoteName.startsWith("-")) return remoteName;
        }
        return `https://github.com/${repository}.git`;
      }),
      Effect.catch(() => Effect.succeed(`https://github.com/${repository}.git`)),
    );

  const localPullRequestDiff = (
    cwd: string,
    repository: string,
    number: number,
  ): Effect.Effect<{ patch: string; truncated: boolean }, GitHubCliError> =>
    Effect.gen(function* () {
      const meta = yield* execute({
        cwd,
        args: [
          "api",
          "--hostname",
          GITHUB_HOST,
          `repos/${repository}/pulls/${number}`,
          "--jq",
          '[.base.ref, .base.sha, .head.sha] | join(" ")',
        ],
      });
      const [baseRef, baseSha, headSha] = meta.stdout.trim().split(/\s+/);
      if (!baseRef || !baseSha || !headSha) {
        return yield* Effect.fail(
          new GitHubCliError({
            operation: "getPullRequestDiff",
            detail: "Could not resolve the pull request's base and head commits.",
            reason: "other",
          }),
        );
      }
      const diff = runGit({
        cwd,
        args: ["diff", "--no-color", `${baseSha}...${headSha}`],
        maxBufferBytes: PULL_REQUEST_DIFF_MAX_BYTES,
        outputMode: "truncate",
      });
      const fetchPullRequestRefs = (fetchSource: string, history?: { deepen: number }) =>
        runGit({
          cwd,
          args: [
            "fetch",
            "--quiet",
            ...(history === undefined ? [] : [`--deepen=${history.deepen}`]),
            "--",
            fetchSource,
            `refs/pull/${number}/head`,
            baseRef,
          ],
          timeoutMs: 120_000,
        });
      const deepenShallowHistoryAndDiff = (fetchSource: string, initialError: GitHubCliError) =>
        Effect.gen(function* () {
          let lastError = initialError;
          for (const deepenBy of [256, 1_024] as const) {
            yield* fetchPullRequestRefs(fetchSource, { deepen: deepenBy });
            const attempt = yield* diff.pipe(
              Effect.map((value) => ({ success: true as const, value })),
              Effect.catch((error) => Effect.succeed({ success: false as const, error })),
            );
            if (attempt.success) return attempt.value;
            lastError = attempt.error;
            if (!/no merge base/i.test(lastError.detail)) return yield* Effect.fail(lastError);
          }
          return yield* Effect.fail(lastError);
        });
      const result = yield* diff.pipe(
        Effect.catch((error) =>
          !/bad object|unknown revision|not a valid object name|no merge base|bad revision/i.test(
            error.detail,
          )
            ? Effect.fail(error)
            : resolvePullRequestFetchSource(cwd, repository).pipe(
                Effect.flatMap((fetchSource) =>
                  runGit({ cwd, args: ["rev-parse", "--is-shallow-repository"] }).pipe(
                    Effect.flatMap((shallowResult) => {
                      const isShallow = shallowResult.stdout.trim() === "true";
                      return fetchPullRequestRefs(
                        fetchSource,
                        isShallow ? { deepen: 64 } : undefined,
                      ).pipe(
                        Effect.flatMap(() =>
                          diff.pipe(
                            Effect.catch((retryError) =>
                              isShallow && /no merge base/i.test(retryError.detail)
                                ? deepenShallowHistoryAndDiff(fetchSource, retryError)
                                : Effect.fail(retryError),
                            ),
                          ),
                        ),
                      );
                    }),
                  ),
                ),
              ),
        ),
      );
      return { patch: result.stdout, truncated: result.stdoutTruncated === true };
    });

  return { execute, localPullRequestDiff };
}

export function validateRepository(
  repository: string,
  operation: string,
): Effect.Effect<string, GitHubCliError> {
  const normalized = repository.trim();
  return isValidGitHubRepositoryNameWithOwner(normalized)
    ? Effect.succeed(normalized)
    : Effect.fail(
        new GitHubCliError({
          operation,
          detail: "Invalid GitHub repository identity.",
          reason: "other",
        }),
      );
}

export const repositorySelector = (repository: string) => `${GITHUB_HOST}/${repository}`;
