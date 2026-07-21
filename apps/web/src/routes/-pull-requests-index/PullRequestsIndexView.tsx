import { lazy, Suspense } from "react";

import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "~/components/chat/chatHeaderControls";
import {
  CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
} from "~/components/chat/composerPickerStyles";
import { PanelStateMessage } from "~/components/chat/PanelStateMessage";
import {
  RIGHT_DOCK_DEFAULT_WIDTH,
  RIGHT_DOCK_MIN_WIDTH,
  RightDock,
} from "~/components/chat/RightDock";
import { PullRequestList } from "~/components/pullRequest/PullRequestList";
import {
  PullRequestFilterPillGroup,
  PullRequestProjectFilterPopover,
} from "~/components/pullRequest/PullRequestListFilters";
import { PR_FINE_TEXT_CLASS_NAME } from "~/components/pullRequest/pullRequestText";
import { PullRequestsUnavailableState } from "~/components/pullRequest/PullRequestsUnavailableState";
import { PullRequestWarningNote } from "~/components/pullRequest/PullRequestWarningNote";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { SearchInput } from "~/components/ui/search-input";
import { Skeleton } from "~/components/ui/skeleton";
import {
  useDesktopTopBarTrafficLightGutterClassName,
  useDesktopTopBarWindowControlsGutterClassName,
} from "~/hooks/useDesktopTopBarGutter";
import { RefreshCwIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import {
  CLEARED_SELECTION,
  INVOLVEMENT_TABS,
  STATE_TABS,
  type PullRequestsSearch,
  type UpdatePullRequestsSearch,
} from "./pullRequestsIndexSearch";
import { usePullRequestsIndexController } from "./usePullRequestsIndexController";

const PullRequestDockPane = lazy(() => import("~/components/pullRequest/PullRequestDockPane"));

interface PullRequestsIndexViewProps {
  search: PullRequestsSearch;
  updateSearch: UpdatePullRequestsSearch;
}

export function PullRequestsIndexView({ search, updateSearch }: PullRequestsIndexViewProps) {
  const trafficLightGutter = useDesktopTopBarTrafficLightGutterClassName();
  const windowControlsGutter = useDesktopTopBarWindowControlsGutterClassName();
  const controller = usePullRequestsIndexController(search, updateSearch);

  return (
    <div className={cn(CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME, CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}>
      <RouteInsetSurface surfaceClassName="bg-transparent">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-background-surface)]">
          <header
            className={cn(
              CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
              CHAT_SURFACE_HEADER_PADDING_X_CLASS,
              "drag-region",
              trafficLightGutter,
              windowControlsGutter,
            )}
          >
            <div className={cn("flex items-center gap-2", CHAT_SURFACE_HEADER_HEIGHT_CLASS)}>
              <SidebarHeaderNavigationControls />
              <h1 className="truncate font-heading text-sm font-medium">Pull requests</h1>
              {controller.scopedProjectName ? (
                <>
                  <span aria-hidden className="text-muted-foreground/50">
                    ·
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {controller.scopedProjectName}
                  </span>
                </>
              ) : null}
              <div className="min-w-0 flex-1" />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Refresh pull requests"
                title={controller.refreshTitle}
                disabled={controller.refreshBlocked}
                onClick={controller.handleManualRefresh}
              >
                <RefreshCwIcon
                  className={cn("size-4", controller.refreshPending && "animate-spin")}
                />
              </Button>
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-5 pb-12 pt-4 sm:px-7">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <PullRequestFilterPillGroup
                    value={search.involvement}
                    options={INVOLVEMENT_TABS}
                    onChange={(involvement) => updateSearch({ involvement, ...CLEARED_SELECTION })}
                  />
                  <PullRequestFilterPillGroup
                    value={search.state}
                    options={STATE_TABS}
                    onIntent={controller.handleStateIntent}
                    onChange={(state) => updateSearch({ state, ...CLEARED_SELECTION })}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <SearchInput
                      placeholder="Search pull requests"
                      value={search.q ?? ""}
                      onChange={(event) => updateSearch({ q: event.target.value || undefined })}
                    />
                  </div>
                  <PullRequestProjectFilterPopover
                    projects={controller.repositoryProjects}
                    value={search.projectId}
                    onChange={(projectId) => updateSearch({ projectId, ...CLEARED_SELECTION })}
                  />
                </div>
              </div>

              {controller.listQuery.isPending || controller.exactInvolvementPending ? (
                <div className="space-y-0.5">
                  {Array.from({ length: 7 }, (_, index) => (
                    <Skeleton key={index} className="h-13 w-full rounded-lg" />
                  ))}
                </div>
              ) : controller.initialListError ? (
                <PullRequestsUnavailableState
                  error={controller.initialListError}
                  onRetry={() => void controller.listQuery.refetch()}
                />
              ) : controller.initialExactInvolvementError ? (
                <PullRequestsUnavailableState
                  error={controller.initialExactInvolvementError}
                  onRetry={() => void controller.exactInvolvementQuery.refetch()}
                />
              ) : controller.entries.length === 0 ? (
                <Empty className="py-16">
                  <EmptyHeader>
                    <EmptyTitle>
                      {search.involvement === "reviewing" && search.state !== "open"
                        ? "Review requests only apply to open pull requests"
                        : "No pull requests found"}
                    </EmptyTitle>
                    <EmptyDescription>
                      {search.involvement === "reviewing" && search.state !== "open"
                        ? "Select Open to see pull requests currently awaiting your review."
                        : "Try another involvement, state, project, or search filter."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <PullRequestList
                  entries={controller.entries}
                  grouped={controller.grouped}
                  selectedProjectId={search.selectedProjectId}
                  selectedRepo={search.selectedRepo}
                  selectedNumber={search.number}
                  showProjectTitle={search.projectId === undefined}
                  onSelect={controller.handleSelectPullRequest}
                  onTogglePinned={controller.handleTogglePinned}
                />
              )}
              {!controller.exactInvolvementPending &&
              !controller.initialExactInvolvementError &&
              controller.truncatedRepositoryCount > 0 ? (
                <p className={cn(PR_FINE_TEXT_CLASS_NAME, "px-1 text-muted-foreground")}>
                  Showing the first 50 matching pull requests for{" "}
                  {controller.truncatedRepositoryCount}{" "}
                  {controller.truncatedRepositoryCount === 1 ? "repository" : "repositories"}.
                </p>
              ) : null}
              {!controller.exactInvolvementPending &&
              !controller.initialExactInvolvementError &&
              controller.activeListData?.errors.length ? (
                <PullRequestWarningNote shape="callout">
                  {controller.activeListData.errors.length} project{" "}
                  {controller.activeListData.errors.length === 1
                    ? "repository was"
                    : "repositories were"}{" "}
                  unavailable. Healthy repositories are still shown.
                </PullRequestWarningNote>
              ) : null}
              {controller.backgroundListError ? (
                <PullRequestWarningNote shape="callout" role="status">
                  The latest background refresh failed. Showing the last available pull requests.
                </PullRequestWarningNote>
              ) : null}
            </div>
          </main>
        </div>
      </RouteInsetSurface>
      <RightDock
        state={controller.dockState}
        minWidth={RIGHT_DOCK_MIN_WIDTH}
        defaultWidth={RIGHT_DOCK_DEFAULT_WIDTH}
        shouldAcceptWidth={() => true}
        addMenuKinds={[]}
        {...(controller.paneLabelOverrides
          ? { paneLabelOverrides: controller.paneLabelOverrides }
          : {})}
        {...(controller.paneIconOverrides
          ? { paneIconOverrides: controller.paneIconOverrides }
          : {})}
        onClosePane={controller.closeDetail}
        onCollapse={controller.closeDetail}
        onOpenChange={(open) => {
          if (!open) controller.closeDetail();
        }}
        onAddPane={() => {}}
        renderPane={(pane, context) => (
          <Suspense fallback={<PanelStateMessage>Loading pull request...</PanelStateMessage>}>
            <PullRequestDockPane pane={pane} pollingEnabled={context.isVisible} />
          </Suspense>
        )}
      />
    </div>
  );
}
