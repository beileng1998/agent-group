import type {
  GitRunStackedActionResult,
  GitStackedAction,
  GitStatusResult,
} from "@agent-group/contracts";
import {
  isTemporaryWorktreeBranch,
  resolveUniqueAgentGroupBranchName,
} from "@agent-group/shared/git";

export interface DefaultBranchActionDialogCopy {
  title: string;
  description: string;
  continueLabel: string;
}

export type DefaultBranchConfirmableAction =
  | "push"
  | "create_pr"
  | "commit_push"
  | "commit_push_pr";

export function requiresFeatureBranchForDefaultBranchAction(
  action: DefaultBranchConfirmableAction,
): boolean {
  return action === "create_pr" || action === "commit_push_pr";
}

const SHORT_SHA_LENGTH = 7;
const TOAST_DESCRIPTION_MAX = 72;

function shortenSha(sha: string | undefined): string | null {
  if (!sha) return null;
  return sha.slice(0, SHORT_SHA_LENGTH);
}

function truncateText(
  value: string | undefined,
  maxLength = TOAST_DESCRIPTION_MAX,
): string | undefined {
  if (!value) return undefined;
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return "...".slice(0, maxLength);
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function resolveDefaultCreateBranchName(
  existingBranchNames: readonly string[],
  preferredBranch?: string,
): string {
  return resolveUniqueAgentGroupBranchName(existingBranchNames, preferredBranch);
}

export function buildGitActionProgressStages(input: {
  action: GitStackedAction;
  hasCustomCommitMessage: boolean;
  hasWorkingTreeChanges: boolean;
  forcePushOnly?: boolean;
  pushTarget?: string;
  featureBranch?: boolean;
  shouldPushBeforePr?: boolean;
}): string[] {
  const branchStages = input.featureBranch ? ["Preparing feature branch..."] : [];
  const pushStage = input.pushTarget ? `Pushing to ${input.pushTarget}...` : "Pushing...";
  if (input.action === "push") return [pushStage];
  if (input.action === "create_pr") {
    return input.shouldPushBeforePr ? [pushStage, "Creating PR..."] : ["Creating PR..."];
  }
  const shouldIncludeCommitStages =
    !input.forcePushOnly && (input.action === "commit" || input.hasWorkingTreeChanges);
  const commitStages = !shouldIncludeCommitStages
    ? []
    : input.hasCustomCommitMessage
      ? ["Committing..."]
      : ["Generating commit message...", "Committing..."];
  if (input.action === "commit") return [...branchStages, ...commitStages];
  if (input.action === "commit_push") return [...branchStages, ...commitStages, pushStage];
  return [...branchStages, ...commitStages, pushStage, "Creating PR..."];
}

const withDescription = (title: string, description: string | undefined) =>
  description ? { title, description } : { title };

export function summarizeGitResult(result: GitRunStackedActionResult): {
  title: string;
  description?: string;
} {
  if (result.pr.status === "created" || result.pr.status === "opened_existing") {
    const prNumber = result.pr.number ? ` #${result.pr.number}` : "";
    const title = `${result.pr.status === "created" ? "Created PR" : "Opened PR"}${prNumber}`;
    return withDescription(title, truncateText(result.pr.title));
  }
  if (result.push.status === "pushed") {
    const shortSha = shortenSha(result.commit.commitSha);
    const branch = result.push.upstreamBranch ?? result.push.branch;
    const pushedCommitPart = shortSha ? ` ${shortSha}` : "";
    const branchPart = branch ? ` to ${branch}` : "";
    return withDescription(
      `Pushed${pushedCommitPart}${branchPart}`,
      truncateText(result.commit.subject),
    );
  }
  if (result.commit.status === "created") {
    const shortSha = shortenSha(result.commit.commitSha);
    const title = shortSha ? `Committed ${shortSha}` : "Committed changes";
    return withDescription(title, truncateText(result.commit.subject));
  }
  return { title: "Done" };
}

export function requiresDefaultBranchConfirmation(
  action: GitStackedAction,
  isDefaultBranch: boolean,
): action is DefaultBranchConfirmableAction {
  if (!isDefaultBranch) return false;
  return (
    action === "push" ||
    action === "create_pr" ||
    action === "commit_push" ||
    action === "commit_push_pr"
  );
}

export function resolveDefaultBranchActionDialogCopy(input: {
  action: DefaultBranchConfirmableAction;
  branchName: string;
  includesCommit: boolean;
}): DefaultBranchActionDialogCopy {
  const branchLabel = input.branchName;
  const suffix = ` on "${branchLabel}". You can continue on this branch or create a feature branch and run the same action there.`;
  if (input.action === "push" || input.action === "commit_push") {
    if (input.includesCommit) {
      return {
        title: "Commit & push to default branch?",
        description: `This action will commit and push changes${suffix}`,
        continueLabel: `Commit & push to ${branchLabel}`,
      };
    }
    return {
      title: "Push to default branch?",
      description: `This action will push local commits${suffix}`,
      continueLabel: `Push to ${branchLabel}`,
    };
  }
  if (input.includesCommit) {
    return {
      title: "Create feature branch, commit & PR?",
      description: `Pull requests can't be opened from "${branchLabel}" into itself. This action will create a feature branch, commit your changes there, push it, and create the PR.`,
      continueLabel: "Create feature branch & continue",
    };
  }
  return {
    title: "Create feature branch & PR?",
    description: `Pull requests can't be opened from "${branchLabel}" into itself. This action will create a feature branch from your current commits, push it, and create the PR.`,
    continueLabel: "Create feature branch & continue",
  };
}

export function resolveLiveThreadBranchUpdate(input: {
  threadBranch: string | null;
  gitStatus: GitStatusResult | null;
}): { branch: string | null } | null {
  if (!input.gitStatus) return null;
  if (input.gitStatus.branch === null && input.threadBranch !== null) return null;
  if (input.threadBranch === input.gitStatus.branch) return null;
  if (
    input.threadBranch !== null &&
    input.gitStatus.branch !== null &&
    !isTemporaryWorktreeBranch(input.threadBranch) &&
    isTemporaryWorktreeBranch(input.gitStatus.branch)
  ) {
    return null;
  }
  return { branch: input.gitStatus.branch };
}

export { resolveAutoFeatureBranchName } from "@agent-group/shared/git";
