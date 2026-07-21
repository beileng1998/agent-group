import { lazy, Suspense } from "react";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Skeleton } from "~/components/ui/skeleton";
import { PullRequestSummaryTab } from "../PullRequestSummaryTab";
import { PullRequestTimelineTab } from "../PullRequestTimelineTab";
import { PullRequestsUnavailableState } from "../PullRequestsUnavailableState";
import { PullRequestWarningNote } from "../PullRequestWarningNote";
import type { PullRequestDetailController } from "./usePullRequestDetailController";

const PullRequestCodeTab = lazy(() => import("../PullRequestCodeTab"));

function DetailSkeleton() {
  return (
    <div className="space-y-4 p-5">
      <Skeleton className="h-7 w-4/5" />
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function PullRequestDetailView({ controller }: { controller: PullRequestDetailController }) {
  const { input, tab, detail, detailQuery, detailErrorState } = controller;

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      {detailQuery.isPending ? (
        <DetailSkeleton />
      ) : detailErrorState.initialError ? (
        <PullRequestsUnavailableState
          error={detailErrorState.initialError}
          onRetry={() => void detailQuery.refetch()}
        />
      ) : !detail ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Pull request not found</EmptyTitle>
            <EmptyDescription>The selected pull request could not be loaded.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {detailErrorState.backgroundError ? (
            <PullRequestWarningNote shape="banner" className="shrink-0" role="status">
              Could not refresh pull request details. Showing saved data.
            </PullRequestWarningNote>
          ) : null}
          <div className="min-h-0 flex-1">
            {tab === "summary" ? (
              <PullRequestSummaryTab detail={detail} />
            ) : tab === "timeline" ? (
              <PullRequestTimelineTab detail={detail} />
            ) : (
              <Suspense fallback={<DetailSkeleton />}>
                <PullRequestCodeTab input={input} detail={detail} />
              </Suspense>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
