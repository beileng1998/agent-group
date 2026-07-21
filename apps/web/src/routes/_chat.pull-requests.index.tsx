import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { PullRequestsIndexView } from "./-pull-requests-index/PullRequestsIndexView";
import {
  type PullRequestsSearchPatch,
  validatePullRequestsSearch,
} from "./-pull-requests-index/pullRequestsIndexSearch";

export type { PullRequestsSearch } from "./-pull-requests-index/pullRequestsIndexSearch";

export const Route = createFileRoute("/_chat/pull-requests/")({
  validateSearch: validatePullRequestsSearch,
  component: PullRequestsRouteView,
});

function PullRequestsRouteView() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const updateSearch = useCallback(
    (patch: PullRequestsSearchPatch) =>
      void navigate({
        search: (previous) => {
          const next = { ...previous, ...patch };
          return {
            involvement: next.involvement,
            state: next.state,
            ...(next.projectId ? { projectId: next.projectId } : {}),
            ...(next.selectedProjectId ? { selectedProjectId: next.selectedProjectId } : {}),
            ...(next.selectedRepo ? { selectedRepo: next.selectedRepo } : {}),
            ...(next.number ? { number: next.number } : {}),
            ...(next.q ? { q: next.q } : {}),
          };
        },
        replace: true,
      }),
    [navigate],
  );

  return <PullRequestsIndexView search={search} updateSearch={updateSearch} />;
}
