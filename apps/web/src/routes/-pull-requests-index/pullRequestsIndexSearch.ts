import type { ProjectId, PullRequestInvolvement, PullRequestState } from "@agent-group/contracts";
import { isValidGitHubRepositoryNameWithOwner } from "@agent-group/shared/githubRepository";

export interface PullRequestsSearch {
  involvement: PullRequestInvolvement;
  state: PullRequestState;
  projectId?: ProjectId;
  selectedProjectId?: ProjectId;
  selectedRepo?: string;
  number?: number;
  q?: string;
}

export interface PullRequestsSearchPatch {
  involvement?: PullRequestInvolvement;
  state?: PullRequestState;
  projectId?: ProjectId | undefined;
  selectedProjectId?: ProjectId | undefined;
  selectedRepo?: string | undefined;
  number?: number | undefined;
  q?: string | undefined;
}

export type UpdatePullRequestsSearch = (patch: PullRequestsSearchPatch) => void;

// Every filter change and the panel close drop the current selection the same way; keep the
// patch in one place so a new selection field can't be forgotten by one of the call sites.
export const CLEARED_SELECTION = {
  selectedProjectId: undefined,
  selectedRepo: undefined,
  number: undefined,
} as const satisfies PullRequestsSearchPatch;

// The route hosts a single dock pane; a stable id keeps the dock tab's identity across pull
// request switches (the detail panel itself remounts via PullRequestDockPane's key).
export const PULL_REQUESTS_ROUTE_PANE_ID = "pull-requests-route:pull-request";

export const INVOLVEMENT_TABS: ReadonlyArray<{
  value: PullRequestInvolvement;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "reviewing", label: "Reviewing" },
  { value: "authored", label: "Authored" },
];

export const STATE_TABS: ReadonlyArray<{ value: PullRequestState; label: string }> = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "merged", label: "Merged" },
];

export function validatePullRequestsSearch(raw: Record<string, unknown>): PullRequestsSearch {
  return {
    involvement:
      raw.involvement === "reviewing" || raw.involvement === "authored" ? raw.involvement : "all",
    state: raw.state === "closed" || raw.state === "merged" ? raw.state : "open",
    ...(typeof raw.projectId === "string" && raw.projectId
      ? { projectId: raw.projectId as ProjectId }
      : {}),
    ...(typeof raw.selectedProjectId === "string" && raw.selectedProjectId
      ? { selectedProjectId: raw.selectedProjectId as ProjectId }
      : {}),
    ...(typeof raw.selectedRepo === "string" &&
    isValidGitHubRepositoryNameWithOwner(raw.selectedRepo)
      ? { selectedRepo: raw.selectedRepo.trim() }
      : {}),
    ...(typeof raw.number === "number" && Number.isInteger(raw.number) && raw.number > 0
      ? { number: raw.number }
      : {}),
    ...(typeof raw.q === "string" && raw.q ? { q: raw.q.slice(0, 200) } : {}),
  };
}
