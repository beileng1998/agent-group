import { Effect } from "effect";
import { parseGitHubRepositoryNameWithOwnerFromRemoteUrl } from "@agent-group/shared/githubRepository";
import type { GitCoreShape } from "../../Services/GitCore.ts";
import type { GitHubCliShape } from "../../Services/GitHubCli.ts";
import {
  appendUnique,
  extractBranchFromRef,
  extractPullRequestUrlFromError,
  inferPullRequestHeadRemoteInfoFromSelector,
  matchesBranchHeadContext,
  parseRepositoryOwnerLogin,
  toPullRequestInfo,
  withInferredHeadRemoteInfo,
} from "./pullRequestIdentity.ts";
import type { BranchHeadContext, PullRequestInfo } from "./gitManagerTypes.ts";

const OPEN_PR_LOOKUP_LIMIT = 10;
const PR_LOOKUP_ALL_STATES_LIMIT = 20;

export function makePullRequestLookup(deps: { gitCore: GitCoreShape; gitHubCli: GitHubCliShape }) {
  const { gitCore, gitHubCli } = deps;
  const readConfigValueNullable = (cwd: string, key: string) =>
    gitCore.readConfigValue(cwd, key).pipe(Effect.catch(() => Effect.succeed(null)));

  const resolveRemoteRepositoryContext = (cwd: string, remoteName: string | null) =>
    Effect.gen(function* () {
      if (!remoteName) {
        return {
          repositoryNameWithOwner: null,
          ownerLogin: null,
        };
      }

      const remoteUrl = yield* readConfigValueNullable(cwd, `remote.${remoteName}.url`);
      const repositoryNameWithOwner = parseGitHubRepositoryNameWithOwnerFromRemoteUrl(remoteUrl);
      return {
        repositoryNameWithOwner,
        ownerLogin: parseRepositoryOwnerLogin(repositoryNameWithOwner),
      };
    });

  const resolveBranchHeadContext = (
    cwd: string,
    details: { branch: string; upstreamRef: string | null },
  ) =>
    Effect.gen(function* () {
      const remoteName = yield* readConfigValueNullable(cwd, `branch.${details.branch}.remote`);
      const headBranchFromUpstream = details.upstreamRef
        ? extractBranchFromRef(details.upstreamRef)
        : "";
      const headBranch =
        headBranchFromUpstream.length > 0 ? headBranchFromUpstream : details.branch;

      const [remoteRepository, originRepository] = yield* Effect.all(
        [
          resolveRemoteRepositoryContext(cwd, remoteName),
          resolveRemoteRepositoryContext(cwd, "origin"),
        ],
        { concurrency: "unbounded" },
      );

      const isCrossRepository =
        remoteRepository.repositoryNameWithOwner !== null &&
        originRepository.repositoryNameWithOwner !== null
          ? remoteRepository.repositoryNameWithOwner.toLowerCase() !==
            originRepository.repositoryNameWithOwner.toLowerCase()
          : remoteName !== null &&
            remoteName !== "origin" &&
            remoteRepository.repositoryNameWithOwner !== null;

      const ownerHeadSelector =
        remoteRepository.ownerLogin && headBranch.length > 0
          ? `${remoteRepository.ownerLogin}:${headBranch}`
          : null;
      const remoteAliasHeadSelector =
        remoteName && headBranch.length > 0 ? `${remoteName}:${headBranch}` : null;
      const shouldProbeRemoteOwnedSelectors = remoteName !== null;

      const headSelectors: string[] = [];
      if (isCrossRepository && shouldProbeRemoteOwnedSelectors) {
        appendUnique(headSelectors, ownerHeadSelector);
        appendUnique(
          headSelectors,
          remoteAliasHeadSelector !== ownerHeadSelector ? remoteAliasHeadSelector : null,
        );
        appendUnique(headSelectors, headBranch);
      }

      appendUnique(headSelectors, details.branch);
      if (!isCrossRepository) {
        appendUnique(headSelectors, headBranch !== details.branch ? headBranch : null);
      }
      if (!isCrossRepository && shouldProbeRemoteOwnedSelectors) {
        appendUnique(headSelectors, ownerHeadSelector);
        appendUnique(
          headSelectors,
          remoteAliasHeadSelector !== ownerHeadSelector ? remoteAliasHeadSelector : null,
        );
      }

      return {
        localBranch: details.branch,
        headBranch,
        headSelectors,
        preferredHeadSelector:
          ownerHeadSelector && isCrossRepository ? ownerHeadSelector : headBranch,
        remoteName,
        headRepositoryNameWithOwner: remoteRepository.repositoryNameWithOwner,
        headRepositoryOwnerLogin: remoteRepository.ownerLogin,
        isCrossRepository,
      } satisfies BranchHeadContext;
    });

  const findOpenPr = (
    cwd: string,
    headContext: Pick<
      BranchHeadContext,
      | "headSelectors"
      | "headBranch"
      | "remoteName"
      | "headRepositoryNameWithOwner"
      | "headRepositoryOwnerLogin"
      | "isCrossRepository"
    >,
  ) =>
    Effect.gen(function* () {
      for (const headSelector of headContext.headSelectors) {
        const pullRequests = yield* gitHubCli.listOpenPullRequests({
          cwd,
          headSelector,
          limit: OPEN_PR_LOOKUP_LIMIT,
        });
        const inferredHeadInfo = inferPullRequestHeadRemoteInfoFromSelector(
          headSelector,
          headContext,
        );

        for (const pullRequest of pullRequests) {
          const candidate = withInferredHeadRemoteInfo(
            toPullRequestInfo(pullRequest),
            inferredHeadInfo,
          );
          if (!matchesBranchHeadContext(candidate, headContext)) {
            continue;
          }

          return candidate;
        }
      }

      return null;
    });

  const findLatestPr = (cwd: string, details: { branch: string; upstreamRef: string | null }) =>
    Effect.gen(function* () {
      const headContext = yield* resolveBranchHeadContext(cwd, details);
      const parsedByNumber = new Map<number, PullRequestInfo>();

      for (const headSelector of headContext.headSelectors) {
        const inferredHeadInfo = inferPullRequestHeadRemoteInfoFromSelector(
          headSelector,
          headContext,
        );
        const pullRequests = yield* gitHubCli.listPullRequests({
          cwd,
          headSelector,
          limit: PR_LOOKUP_ALL_STATES_LIMIT,
        });

        for (const pullRequest of pullRequests) {
          const candidate = withInferredHeadRemoteInfo(
            toPullRequestInfo(pullRequest),
            inferredHeadInfo,
          );
          if (!matchesBranchHeadContext(candidate, headContext)) {
            continue;
          }
          parsedByNumber.set(candidate.number, candidate);
        }
      }

      const parsed = Array.from(parsedByNumber.values()).toSorted((a, b) => {
        const left = a.updatedAt ? Date.parse(a.updatedAt) : 0;
        const right = b.updatedAt ? Date.parse(b.updatedAt) : 0;
        return right - left;
      });

      const latestOpenPr = parsed.find((pr) => pr.state === "open");
      if (latestOpenPr) {
        return latestOpenPr;
      }
      return parsed[0] ?? null;
    });

  const resolveAlreadyExistingPullRequest = (
    cwd: string,
    error: unknown,
    headContext: BranchHeadContext,
  ) =>
    Effect.gen(function* () {
      const pullRequestUrl = extractPullRequestUrlFromError(error);
      if (pullRequestUrl) {
        const pullRequest = yield* gitHubCli
          .getPullRequest({ cwd, reference: pullRequestUrl })
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (pullRequest) {
          const candidate = toPullRequestInfo(pullRequest);
          if (candidate.state === "open" && matchesBranchHeadContext(candidate, headContext)) {
            return candidate;
          }
        }
      }

      // `gh pr create` can race with an existing-PR probe. Treat GitHub's
      // create-time duplicate response as success when the PR can be found.
      return yield* findOpenPr(cwd, headContext);
    });

  const resolveBaseBranch = (
    cwd: string,
    branch: string,
    upstreamRef: string | null,
    headContext: Pick<BranchHeadContext, "isCrossRepository">,
  ) =>
    Effect.gen(function* () {
      const configured = yield* gitCore.readConfigValue(cwd, `branch.${branch}.gh-merge-base`);
      if (configured) return configured;

      if (upstreamRef && !headContext.isCrossRepository) {
        const upstreamBranch = extractBranchFromRef(upstreamRef);
        if (upstreamBranch.length > 0 && upstreamBranch !== branch) {
          return upstreamBranch;
        }
      }

      const defaultFromGh = yield* gitHubCli
        .getDefaultBranch({ cwd })
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (defaultFromGh) {
        return defaultFromGh;
      }

      return "main";
    });

  return {
    resolveBranchHeadContext,
    findOpenPr,
    findLatestPr,
    resolveAlreadyExistingPullRequest,
    resolveBaseBranch,
  };
}
