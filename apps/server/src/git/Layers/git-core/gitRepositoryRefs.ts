import { Cache, Data, Duration, Effect, Exit } from "effect";

import type { GitCommandError } from "../../Errors.ts";
import type { GitCoreShape } from "../../Services/GitCore.ts";
import type { GitOperationContext } from "./gitCoreTypes.ts";
import {
  DEFAULT_BASE_BRANCH_CANDIDATES,
  createGitCommandError,
  normalizeRemoteUrl,
  parseDefaultBranchFromRemoteHeadRef,
  parseRemoteFetchUrls,
  parseRemoteNames,
  sanitizeRemoteName,
} from "./gitCoreValues.ts";

const STATUS_UPSTREAM_REFRESH_INTERVAL = Duration.seconds(15);
const STATUS_UPSTREAM_REFRESH_TIMEOUT = Duration.seconds(5);
const STATUS_UPSTREAM_REFRESH_CACHE_CAPACITY = 2_048;

class StatusUpstreamRefreshCacheKey extends Data.Class<{
  cwd: string;
  upstreamRef: string;
  remoteName: string;
  upstreamBranch: string;
}> {}

export const makeGitRepositoryRefs = Effect.fn(function* (context: GitOperationContext) {
  const { executeGit, runGit, runGitStdout } = context;
  const branchExists = (cwd: string, branch: string): Effect.Effect<boolean, GitCommandError> =>
    executeGit(
      "GitCore.branchExists",
      cwd,
      ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      {
        allowNonZeroExit: true,
        timeoutMs: 5_000,
      },
    ).pipe(Effect.map((result) => result.code === 0));

  const resolveAvailableBranchName = (cwd: string, desiredBranch: string) =>
    Effect.gen(function* () {
      if (!(yield* branchExists(cwd, desiredBranch))) return desiredBranch;
      for (let suffix = 1; suffix <= 100; suffix += 1) {
        const candidate = `${desiredBranch}-${suffix}`;
        if (!(yield* branchExists(cwd, candidate))) return candidate;
      }
      return yield* createGitCommandError(
        "GitCore.renameBranch",
        cwd,
        ["branch", "-m", "--", desiredBranch],
        `Could not find an available branch name for '${desiredBranch}'.`,
      );
    });

  const resolveCurrentUpstream = (cwd: string) =>
    Effect.gen(function* () {
      const upstreamRef = yield* runGitStdout(
        "GitCore.resolveCurrentUpstream",
        cwd,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
        true,
      ).pipe(Effect.map((stdout) => stdout.trim()));
      if (upstreamRef.length === 0 || upstreamRef === "@{upstream}") return null;
      const separatorIndex = upstreamRef.indexOf("/");
      if (separatorIndex <= 0) return null;
      const remoteName = upstreamRef.slice(0, separatorIndex);
      const upstreamBranch = upstreamRef.slice(separatorIndex + 1);
      if (remoteName.length === 0 || upstreamBranch.length === 0) return null;
      return { upstreamRef, remoteName, upstreamBranch };
    });

  const fetchUpstreamRef = (
    cwd: string,
    upstream: { upstreamRef: string; remoteName: string; upstreamBranch: string },
  ) =>
    runGit(
      "GitCore.fetchUpstreamRef",
      cwd,
      [
        "fetch",
        "--quiet",
        "--no-tags",
        upstream.remoteName,
        `+refs/heads/${upstream.upstreamBranch}:refs/remotes/${upstream.upstreamRef}`,
      ],
      true,
    );

  const fetchUpstreamRefForStatus = (
    cwd: string,
    upstream: { upstreamRef: string; remoteName: string; upstreamBranch: string },
  ) =>
    executeGit(
      "GitCore.fetchUpstreamRefForStatus",
      cwd,
      [
        "fetch",
        "--quiet",
        "--no-tags",
        upstream.remoteName,
        `+refs/heads/${upstream.upstreamBranch}:refs/remotes/${upstream.upstreamRef}`,
      ],
      { allowNonZeroExit: true, timeoutMs: Duration.toMillis(STATUS_UPSTREAM_REFRESH_TIMEOUT) },
    ).pipe(Effect.asVoid);

  const statusUpstreamRefreshCache = yield* Cache.makeWith({
    capacity: STATUS_UPSTREAM_REFRESH_CACHE_CAPACITY,
    lookup: (cacheKey: StatusUpstreamRefreshCacheKey) =>
      Effect.gen(function* () {
        yield* fetchUpstreamRefForStatus(cacheKey.cwd, cacheKey);
        return true as const;
      }),
    timeToLive: (exit) => (Exit.isSuccess(exit) ? STATUS_UPSTREAM_REFRESH_INTERVAL : Duration.zero),
  });

  const refreshStatusUpstreamIfStale = (cwd: string) =>
    Effect.gen(function* () {
      const upstream = yield* resolveCurrentUpstream(cwd);
      if (!upstream) return;
      yield* Cache.get(
        statusUpstreamRefreshCache,
        new StatusUpstreamRefreshCacheKey({ cwd, ...upstream }),
      );
    });

  const refreshCheckedOutBranchUpstream = (cwd: string) =>
    Effect.gen(function* () {
      const upstream = yield* resolveCurrentUpstream(cwd);
      if (upstream) yield* fetchUpstreamRef(cwd, upstream);
    });

  const resolveDefaultBranchName = (cwd: string, remoteName: string) =>
    executeGit(
      "GitCore.resolveDefaultBranchName",
      cwd,
      ["symbolic-ref", `refs/remotes/${remoteName}/HEAD`],
      {
        allowNonZeroExit: true,
      },
    ).pipe(
      Effect.map((result) =>
        result.code === 0 ? parseDefaultBranchFromRemoteHeadRef(result.stdout, remoteName) : null,
      ),
    );

  const remoteBranchExists = (cwd: string, remoteName: string, branch: string) =>
    executeGit(
      "GitCore.remoteBranchExists",
      cwd,
      ["show-ref", "--verify", "--quiet", `refs/remotes/${remoteName}/${branch}`],
      {
        allowNonZeroExit: true,
      },
    ).pipe(Effect.map((result) => result.code === 0));

  const originRemoteExists = (cwd: string) =>
    executeGit("GitCore.originRemoteExists", cwd, ["remote", "get-url", "origin"], {
      allowNonZeroExit: true,
    }).pipe(Effect.map((result) => result.code === 0));

  const listRemoteNames = (cwd: string) =>
    runGitStdout("GitCore.listRemoteNames", cwd, ["remote"]).pipe(
      Effect.map((stdout) => parseRemoteNames(stdout).toReversed()),
    );

  const resolvePrimaryRemoteName = (cwd: string) =>
    Effect.gen(function* () {
      if (yield* originRemoteExists(cwd)) return "origin";
      const [firstRemote] = yield* listRemoteNames(cwd);
      if (firstRemote) return firstRemote;
      return yield* createGitCommandError(
        "GitCore.resolvePrimaryRemoteName",
        cwd,
        ["remote"],
        "No git remote is configured for this repository.",
      );
    });

  const resolvePushRemoteName = (cwd: string, branch: string) =>
    Effect.gen(function* () {
      const branchPushRemote = yield* runGitStdout(
        "GitCore.resolvePushRemoteName.branchPushRemote",
        cwd,
        ["config", "--get", `branch.${branch}.pushRemote`],
        true,
      ).pipe(Effect.map((stdout) => stdout.trim()));
      if (branchPushRemote.length > 0) return branchPushRemote;
      const pushDefaultRemote = yield* runGitStdout(
        "GitCore.resolvePushRemoteName.remotePushDefault",
        cwd,
        ["config", "--get", "remote.pushDefault"],
        true,
      ).pipe(Effect.map((stdout) => stdout.trim()));
      if (pushDefaultRemote.length > 0) return pushDefaultRemote;
      return yield* resolvePrimaryRemoteName(cwd).pipe(Effect.catch(() => Effect.succeed(null)));
    });

  const ensureRemote: GitCoreShape["ensureRemote"] = (input) =>
    Effect.gen(function* () {
      const preferredName = sanitizeRemoteName(input.preferredName);
      const normalizedTargetUrl = normalizeRemoteUrl(input.url);
      const remoteFetchUrls = yield* runGitStdout(
        "GitCore.ensureRemote.listRemoteUrls",
        input.cwd,
        ["remote", "-v"],
      ).pipe(Effect.map(parseRemoteFetchUrls));
      for (const [remoteName, remoteUrl] of remoteFetchUrls.entries()) {
        if (normalizeRemoteUrl(remoteUrl) === normalizedTargetUrl) return remoteName;
      }
      let remoteName = preferredName;
      let suffix = 1;
      while (remoteFetchUrls.has(remoteName)) {
        remoteName = `${preferredName}-${suffix}`;
        suffix += 1;
      }
      yield* runGit("GitCore.ensureRemote.add", input.cwd, [
        "remote",
        "add",
        remoteName,
        input.url,
      ]);
      return remoteName;
    });

  const resolveBaseBranchForNoUpstream = (cwd: string, branch: string) =>
    Effect.gen(function* () {
      const configuredBaseBranch = yield* runGitStdout(
        "GitCore.resolveBaseBranchForNoUpstream.config",
        cwd,
        ["config", "--get", `branch.${branch}.gh-merge-base`],
        true,
      ).pipe(Effect.map((stdout) => stdout.trim()));
      const primaryRemoteName = yield* resolvePrimaryRemoteName(cwd).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      const defaultBranch =
        primaryRemoteName === null ? null : yield* resolveDefaultBranchName(cwd, primaryRemoteName);
      const candidates = [
        configuredBaseBranch.length > 0 ? configuredBaseBranch : null,
        defaultBranch,
        ...DEFAULT_BASE_BRANCH_CANDIDATES,
      ];
      for (const candidate of candidates) {
        if (!candidate) continue;
        const remotePrefix =
          primaryRemoteName && primaryRemoteName !== "origin" ? `${primaryRemoteName}/` : null;
        const normalizedCandidate = candidate.startsWith("origin/")
          ? candidate.slice("origin/".length)
          : remotePrefix && candidate.startsWith(remotePrefix)
            ? candidate.slice(remotePrefix.length)
            : candidate;
        if (normalizedCandidate.length === 0 || normalizedCandidate === branch) continue;
        if (yield* branchExists(cwd, normalizedCandidate)) return normalizedCandidate;
        if (
          primaryRemoteName &&
          (yield* remoteBranchExists(cwd, primaryRemoteName, normalizedCandidate))
        ) {
          return `${primaryRemoteName}/${normalizedCandidate}`;
        }
      }
      return null;
    });

  const computeAheadCountAgainstBase = (cwd: string, branch: string) =>
    Effect.gen(function* () {
      const baseBranch = yield* resolveBaseBranchForNoUpstream(cwd, branch);
      if (!baseBranch) return 0;
      const result = yield* executeGit(
        "GitCore.computeAheadCountAgainstBase",
        cwd,
        ["rev-list", "--count", `${baseBranch}..HEAD`],
        { allowNonZeroExit: true },
      );
      if (result.code !== 0) return 0;
      const parsed = Number.parseInt(result.stdout.trim(), 10);
      return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    });

  return {
    branchExists,
    resolveAvailableBranchName,
    resolveCurrentUpstream,
    refreshStatusUpstreamIfStale,
    refreshCheckedOutBranchUpstream,
    resolveDefaultBranchName,
    remoteBranchExists,
    resolvePrimaryRemoteName,
    resolvePushRemoteName,
    ensureRemote,
    resolveBaseBranchForNoUpstream,
    computeAheadCountAgainstBase,
  };
});

export type GitRepositoryRefs =
  ReturnType<typeof makeGitRepositoryRefs> extends Effect.Effect<infer Value, unknown, unknown>
    ? Value
    : never;
