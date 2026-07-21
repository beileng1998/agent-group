import { realpathSync } from "node:fs";

import { sanitizeBranchFragment } from "@agent-group/shared/git";
import type { GitHubPullRequestSummary } from "../../Services/GitHubCli.ts";
import type {
  BranchHeadContext,
  PullRequestHeadRemoteInfo,
  PullRequestInfo,
  ResolvedPullRequest,
} from "./gitManagerTypes.ts";

export function parsePullRequestRepositoryFromUrl(
  url: string,
): { host: string; owner: string; repo: string } | null {
  const match = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/\d+(?:\/.*)?$/i.exec(url.trim());
  const host = match?.[1]?.trim() ?? "";
  const owner = match?.[2]?.trim() ?? "";
  const repo = match?.[3]?.trim() ?? "";
  return host.length > 0 && owner.length > 0 && repo.length > 0 ? { host, owner, repo } : null;
}

// github.com-only on purpose: callers use it to reconstruct `owner/repo` for fork heads,
// which is only well-defined for PRs hosted on github.com.
export function parseRepositoryNameFromPullRequestUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!/^https:\/\//i.test(trimmed)) {
    return null;
  }
  const repository = parsePullRequestRepositoryFromUrl(trimmed);
  return repository && repository.host.toLowerCase() === "github.com" ? repository.repo : null;
}

export function resolveHeadRepositoryNameWithOwner(
  pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
): string | null {
  const explicitRepository = pullRequest.headRepositoryNameWithOwner?.trim() ?? "";
  if (explicitRepository.length > 0) {
    return explicitRepository;
  }

  if (!pullRequest.isCrossRepository) {
    return null;
  }

  const ownerLogin = pullRequest.headRepositoryOwnerLogin?.trim() ?? "";
  const repositoryName = parseRepositoryNameFromPullRequestUrl(pullRequest.url);
  if (ownerLogin.length === 0 || !repositoryName) {
    return null;
  }

  return `${ownerLogin}/${repositoryName}`;
}

export function resolvePullRequestWorktreeLocalBranchName(
  pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
): string {
  if (!pullRequest.isCrossRepository) {
    return pullRequest.headBranch;
  }

  const sanitizedHeadBranch = sanitizeBranchFragment(pullRequest.headBranch).trim();
  const suffix = sanitizedHeadBranch.length > 0 ? sanitizedHeadBranch : "head";
  return `agent-group/pr-${pullRequest.number}/${suffix}`;
}

export function parseRepositoryOwnerLogin(nameWithOwner: string | null): string | null {
  const trimmed = nameWithOwner?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }
  const [ownerLogin] = trimmed.split("/");
  const normalizedOwnerLogin = ownerLogin?.trim() ?? "";
  return normalizedOwnerLogin.length > 0 ? normalizedOwnerLogin : null;
}

export function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeOptionalRepositoryNameWithOwner(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toLowerCase() : null;
}

export function normalizeOptionalOwnerLogin(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toLowerCase() : null;
}

export function resolvePullRequestHeadRepositoryNameWithOwner(
  pr: PullRequestHeadRemoteInfo & { url: string },
): string | null {
  const explicitRepository = normalizeOptionalString(pr.headRepositoryNameWithOwner);
  if (explicitRepository) {
    return explicitRepository;
  }

  if (!pr.isCrossRepository) {
    return null;
  }

  const ownerLogin = normalizeOptionalString(pr.headRepositoryOwnerLogin);
  const repositoryName = parseRepositoryNameFromPullRequestUrl(pr.url);
  if (!ownerLogin || !repositoryName) {
    return null;
  }

  return `${ownerLogin}/${repositoryName}`;
}

export function matchesBranchHeadContext(
  pr: PullRequestInfo,
  headContext: Pick<
    BranchHeadContext,
    "headBranch" | "headRepositoryNameWithOwner" | "headRepositoryOwnerLogin" | "isCrossRepository"
  >,
): boolean {
  if (pr.headRefName !== headContext.headBranch) {
    return false;
  }

  const expectedHeadRepository = normalizeOptionalRepositoryNameWithOwner(
    headContext.headRepositoryNameWithOwner,
  );
  const expectedHeadOwner =
    normalizeOptionalOwnerLogin(headContext.headRepositoryOwnerLogin) ??
    parseRepositoryOwnerLogin(expectedHeadRepository);
  const prHeadRepository = normalizeOptionalRepositoryNameWithOwner(
    resolvePullRequestHeadRepositoryNameWithOwner(pr),
  );
  const prHeadOwner =
    normalizeOptionalOwnerLogin(pr.headRepositoryOwnerLogin) ??
    parseRepositoryOwnerLogin(prHeadRepository);

  if (headContext.isCrossRepository) {
    if (pr.isCrossRepository === false) {
      return false;
    }
    if ((expectedHeadRepository || expectedHeadOwner) && !prHeadRepository && !prHeadOwner) {
      return false;
    }
    if (expectedHeadRepository && prHeadRepository && expectedHeadRepository !== prHeadRepository) {
      return false;
    }
    if (expectedHeadOwner && prHeadOwner && expectedHeadOwner !== prHeadOwner) {
      return false;
    }
    return true;
  }

  if (pr.isCrossRepository === true) {
    return false;
  }
  if (expectedHeadRepository && prHeadRepository && expectedHeadRepository !== prHeadRepository) {
    return false;
  }
  if (expectedHeadOwner && prHeadOwner && expectedHeadOwner !== prHeadOwner) {
    return false;
  }
  return true;
}

// Normalizes `gh pr view/list` service output into the richer internal PR shape.
export function toPullRequestInfo(pullRequest: GitHubPullRequestSummary): PullRequestInfo {
  return {
    ...pullRequest,
    state: pullRequest.state ?? "open",
    updatedAt: pullRequest.updatedAt ?? null,
  };
}

// Detects GitHub's duplicate-PR response from `gh pr create`.
export function isPullRequestAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("pull request") &&
    message.includes("branch") &&
    message.includes("already exists")
  );
}

// Pulls the existing PR URL out of GitHub's duplicate-PR error when present.
export function extractPullRequestUrlFromError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const match = /https:\/\/github\.com\/[^\s)]+\/pull\/\d+/i.exec(error.message);
  return match?.[0] ?? null;
}

export function extractBranchFromRef(ref: string): string {
  const normalized = ref.trim();

  if (normalized.startsWith("refs/remotes/")) {
    const withoutPrefix = normalized.slice("refs/remotes/".length);
    const firstSlash = withoutPrefix.indexOf("/");
    if (firstSlash === -1) {
      return withoutPrefix.trim();
    }
    return withoutPrefix.slice(firstSlash + 1).trim();
  }

  const firstSlash = normalized.indexOf("/");
  if (firstSlash === -1) {
    return normalized;
  }
  return normalized.slice(firstSlash + 1).trim();
}

export function appendUnique(values: string[], next: string | null | undefined): void {
  const trimmed = next?.trim() ?? "";
  if (trimmed.length === 0 || values.includes(trimmed)) {
    return;
  }
  values.push(trimmed);
}

export function normalizePullRequestReference(reference: string): string {
  const trimmed = reference.trim();
  const hashNumber = /^#(\d+)$/.exec(trimmed);
  return hashNumber?.[1] ?? trimmed;
}

export function canonicalizeExistingPath(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    return value;
  }
}

export function toResolvedPullRequest(pr: {
  number: number;
  title: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  state?: "open" | "closed" | "merged";
  isDraft?: boolean;
  mergeability?: "mergeable" | "conflicting" | "unknown";
  additions?: number | null;
  deletions?: number | null;
  changedFiles?: number | null;
}): ResolvedPullRequest {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    baseBranch: pr.baseRefName,
    headBranch: pr.headRefName,
    state: pr.state ?? "open",
    isDraft: pr.isDraft ?? false,
    mergeability: pr.mergeability ?? "unknown",
    additions: pr.additions ?? null,
    deletions: pr.deletions ?? null,
    changedFiles: pr.changedFiles ?? null,
  };
}

export function shouldPreferSshRemote(url: string | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return trimmed.startsWith("git@") || trimmed.startsWith("ssh://");
}

export function toPullRequestHeadRemoteInfo(pr: {
  isCrossRepository?: boolean;
  headRepositoryNameWithOwner?: string | null;
  headRepositoryOwnerLogin?: string | null;
}): PullRequestHeadRemoteInfo {
  return {
    ...(pr.isCrossRepository !== undefined ? { isCrossRepository: pr.isCrossRepository } : {}),
    ...(pr.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: pr.headRepositoryNameWithOwner }
      : {}),
    ...(pr.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: pr.headRepositoryOwnerLogin }
      : {}),
  };
}

// Older gh versions omit the head-repository fields from `pr list` JSON; fall back to what
// the head selector implies so cross-repo matching still works. Shared by the open-PR and
// any-state PR lookups.
export function withInferredHeadRemoteInfo(
  pr: PullRequestInfo,
  inferred: PullRequestHeadRemoteInfo,
): PullRequestInfo {
  const reportedByGh =
    pr.isCrossRepository !== undefined ||
    pr.headRepositoryNameWithOwner !== undefined ||
    pr.headRepositoryOwnerLogin !== undefined;
  return reportedByGh ? pr : { ...pr, ...toPullRequestHeadRemoteInfo(inferred) };
}

export function inferPullRequestHeadRemoteInfoFromSelector(
  headSelector: string,
  headContext: Pick<
    BranchHeadContext,
    | "headBranch"
    | "remoteName"
    | "headRepositoryNameWithOwner"
    | "headRepositoryOwnerLogin"
    | "isCrossRepository"
  >,
): PullRequestHeadRemoteInfo {
  const separatorIndex = headSelector.indexOf(":");
  if (separatorIndex > 0 && separatorIndex < headSelector.length - 1) {
    const selectorPrefix = headSelector.slice(0, separatorIndex);
    if (selectorPrefix === headContext.remoteName) {
      return {
        isCrossRepository: headContext.isCrossRepository,
        ...(headContext.headRepositoryNameWithOwner
          ? { headRepositoryNameWithOwner: headContext.headRepositoryNameWithOwner }
          : {}),
        ...(headContext.headRepositoryOwnerLogin
          ? { headRepositoryOwnerLogin: headContext.headRepositoryOwnerLogin }
          : {}),
      };
    }

    return {
      isCrossRepository: true,
      headRepositoryOwnerLogin: selectorPrefix,
    };
  }

  if (headContext.isCrossRepository && headSelector === headContext.headBranch) {
    return {
      isCrossRepository: true,
      ...(headContext.headRepositoryNameWithOwner
        ? { headRepositoryNameWithOwner: headContext.headRepositoryNameWithOwner }
        : {}),
      ...(headContext.headRepositoryOwnerLogin
        ? { headRepositoryOwnerLogin: headContext.headRepositoryOwnerLogin }
        : {}),
    };
  }

  return {};
}
