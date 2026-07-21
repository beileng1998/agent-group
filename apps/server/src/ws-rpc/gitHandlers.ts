import {
  WS_METHODS,
  WsRpcError,
  PullRequestsUnavailableError,
  type GitActionProgressEvent,
} from "@agent-group/contracts";
import { Effect, Queue, Stream } from "effect";

import { GitHubCliError } from "../git/Errors";
import { GitCore } from "../git/Services/GitCore";
import { GitManager } from "../git/Services/GitManager";
import { GitStatusBroadcaster } from "../git/Services/GitStatusBroadcaster";
import { PullRequestService } from "../pullRequests/Services/PullRequestService";
import { resolveGitHubRepository } from "../pullRequests/repositoryResolution";
import { bufferLiveUiStream } from "../wsStreamBackpressure";
import { toWsRpcError } from "../wsRpcError";
import type { WsRpcHandlers } from "./types";

export function makeGitHandlers(dependencies: {
  readonly git: typeof GitCore.Service;
  readonly gitManager: typeof GitManager.Service;
  readonly gitStatusBroadcaster: typeof GitStatusBroadcaster.Service;
  readonly pullRequests: typeof PullRequestService.Service;
  readonly rpcEffect: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    fallbackMessage: string,
  ) => Effect.Effect<A, WsRpcError, R>;
}) {
  const isGlobalGitHubCliError = (error: unknown): error is GitHubCliError =>
    error instanceof GitHubCliError &&
    (error.reason === "not-installed" || error.reason === "not-authenticated");

  const toPullRequestsRpcError = (cause: unknown, fallbackMessage: string) => {
    if (isGlobalGitHubCliError(cause)) {
      return new PullRequestsUnavailableError({
        reason: cause.reason === "not-installed" ? "gh-not-installed" : "gh-not-authenticated",
        message: cause.detail,
      });
    }
    return toWsRpcError(cause, fallbackMessage);
  };

  const pullRequestsEffect = <A, E, R>(effect: Effect.Effect<A, E, R>, fallbackMessage: string) =>
    effect.pipe(Effect.mapError((cause) => toPullRequestsRpcError(cause, fallbackMessage)));

  const refreshGitStatus = (cwd: string) =>
    dependencies.gitStatusBroadcaster.refreshStatus(cwd).pipe(Effect.catchCause(() => Effect.void));

  return {
    [WS_METHODS.gitGithubRepository]: (input) =>
      dependencies.rpcEffect(
        resolveGitHubRepository(dependencies.git, input.cwd),
        "Failed to resolve GitHub repository",
      ),
    [WS_METHODS.gitStatus]: (input) =>
      dependencies.rpcEffect(
        dependencies.gitStatusBroadcaster.getStatus(input),
        "Failed to read git status",
      ),
    [WS_METHODS.gitReadWorkingTreeDiff]: (input) =>
      dependencies.rpcEffect(
        dependencies.gitManager.readWorkingTreeDiff(input),
        "Failed to read working tree diff",
      ),
    [WS_METHODS.gitSummarizeDiff]: (input) =>
      dependencies.rpcEffect(
        dependencies.gitManager.summarizeDiff(input),
        "Failed to summarize diff",
      ),
    [WS_METHODS.gitPull]: (input) =>
      dependencies.rpcEffect(
        dependencies.git
          .pullCurrentBranch(input.cwd)
          .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
        "Failed to pull branch",
      ),
    [WS_METHODS.gitRunStackedAction]: (input) =>
      bufferLiveUiStream(
        Stream.callback<GitActionProgressEvent, WsRpcError>((queue) =>
          dependencies.gitManager
            .runStackedAction(input, {
              actionId: input.actionId,
              progressReporter: {
                publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
              },
            })
            .pipe(
              Effect.tap(() => refreshGitStatus(input.cwd)),
              Effect.matchCauseEffect({
                onFailure: (cause) => Queue.fail(queue, toWsRpcError(cause, "Git action failed")),
                onSuccess: () => Queue.end(queue).pipe(Effect.asVoid),
              }),
            ),
        ),
        { label: "git.stacked-action" },
      ),
    [WS_METHODS.gitResolvePullRequest]: (input) =>
      dependencies.rpcEffect(
        dependencies.gitManager.resolvePullRequest(input),
        "Failed to resolve pull request",
      ),
    [WS_METHODS.gitPullRequestSnapshot]: (input) =>
      dependencies.rpcEffect(
        dependencies.gitManager.pullRequestSnapshot(input),
        "Failed to load pull request checks and comments",
      ),
    [WS_METHODS.gitPreparePullRequestThread]: (input) =>
      dependencies.rpcEffect(
        dependencies.gitManager
          .preparePullRequestThread(input)
          .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
        "Failed to prepare pull request thread",
      ),
    [WS_METHODS.pullRequestsList]: (input) =>
      pullRequestsEffect(dependencies.pullRequests.list(input), "Failed to list pull requests"),
    [WS_METHODS.pullRequestsReviewRequestCount]: (input) =>
      pullRequestsEffect(
        dependencies.pullRequests.reviewRequestCount(input),
        "Failed to count pull request review requests",
      ),
    [WS_METHODS.pullRequestsDetail]: (input) =>
      pullRequestsEffect(dependencies.pullRequests.detail(input), "Failed to load pull request"),
    [WS_METHODS.pullRequestsDiff]: (input) =>
      pullRequestsEffect(dependencies.pullRequests.diff(input), "Failed to load pull request diff"),
    [WS_METHODS.pullRequestsAction]: (input) =>
      pullRequestsEffect(dependencies.pullRequests.action(input), "Pull request action failed"),
    [WS_METHODS.pullRequestsComment]: (input) =>
      pullRequestsEffect(dependencies.pullRequests.comment(input), "Could not post the comment"),
    [WS_METHODS.pullRequestsSetPinned]: (input) =>
      dependencies.rpcEffect(
        dependencies.pullRequests.setPinned(input),
        "Failed to update pull request pin",
      ),
    [WS_METHODS.gitListBranches]: (input) =>
      dependencies.rpcEffect(dependencies.git.listBranches(input), "Failed to list branches"),
    [WS_METHODS.gitCreateWorktree]: (input) =>
      dependencies.rpcEffect(
        dependencies.git.createWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
        "Failed to create worktree",
      ),
    [WS_METHODS.gitCreateDetachedWorktree]: (input) =>
      dependencies.rpcEffect(
        dependencies.git
          .createDetachedWorktree(input)
          .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
        "Failed to create detached worktree",
      ),
    [WS_METHODS.gitRemoveWorktree]: (input) =>
      dependencies.rpcEffect(
        dependencies.git.removeWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
        "Failed to remove worktree",
      ),
    [WS_METHODS.gitCreateBranch]: (input) =>
      dependencies.rpcEffect(
        dependencies.git.createBranch(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
        "Failed to create branch",
      ),
    [WS_METHODS.gitCheckout]: (input) =>
      dependencies.rpcEffect(
        Effect.scoped(dependencies.git.checkoutBranch(input)).pipe(
          Effect.tap(() => refreshGitStatus(input.cwd)),
        ),
        "Failed to checkout branch",
      ),
    [WS_METHODS.gitStashAndCheckout]: (input) =>
      dependencies.rpcEffect(
        Effect.scoped(dependencies.git.stashAndCheckout(input)).pipe(
          Effect.tap(() => refreshGitStatus(input.cwd)),
        ),
        "Failed to stash and checkout",
      ),
    [WS_METHODS.gitStashDrop]: (input) =>
      dependencies.rpcEffect(
        dependencies.git.stashDrop(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
        "Failed to drop stash",
      ),
    [WS_METHODS.gitStashInfo]: (input) =>
      dependencies.rpcEffect(dependencies.git.stashInfo(input), "Failed to read stash"),
    [WS_METHODS.gitRemoveIndexLock]: (input) =>
      dependencies.rpcEffect(
        dependencies.git.removeIndexLock(input),
        "Failed to remove Git index lock",
      ),
    [WS_METHODS.gitInit]: (input) =>
      dependencies.rpcEffect(
        dependencies.git.initRepo(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
        "Failed to initialize repository",
      ),
    [WS_METHODS.gitStageFiles]: (input) =>
      dependencies.rpcEffect(
        dependencies.git.stageFiles(input.cwd, input.paths).pipe(
          Effect.tap(() => refreshGitStatus(input.cwd)),
          Effect.as({ ok: true }),
        ),
        "Failed to stage files",
      ),
    [WS_METHODS.gitUnstageFiles]: (input) =>
      dependencies.rpcEffect(
        dependencies.git.unstageFiles(input.cwd, input.paths).pipe(
          Effect.tap(() => refreshGitStatus(input.cwd)),
          Effect.as({ ok: true }),
        ),
        "Failed to unstage files",
      ),
    [WS_METHODS.gitHandoffThread]: (input) =>
      dependencies.rpcEffect(
        dependencies.gitManager
          .handoffThread(input)
          .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
        "Failed to hand off thread",
      ),
  } satisfies Partial<WsRpcHandlers>;
}
