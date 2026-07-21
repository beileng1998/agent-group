// FILE: useSidebarAttentionOwner.ts
// Purpose: Own sidebar automation and pull-request attention queries and presentation state.
// Layer: Web sidebar orchestration owner

import type { AutomationListResult } from "@agent-group/contracts";
import { pluralize } from "@agent-group/shared/text";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import {
  pullRequestQueryKeys,
  pullRequestReviewRequestCountQueryOptions,
} from "../lib/pullRequestReactQuery";
import { ensureNativeApi } from "../nativeApi";
import {
  applyAutomationEvent,
  automationAttentionCount,
  automationQueryKey,
  groupHeartbeatAutomationsByTargetThread,
} from "../routes/-automations.shared";
import type { Project } from "../types";
import {
  pullRequestRepositoryConfigFingerprint,
  resolvePullRequestReviewBadge,
} from "../components/Sidebar.logic";

export type SidebarAttentionOwnerInput = {
  readonly projects: readonly Project[];
};

export function useSidebarAttentionOwner(input: SidebarAttentionOwnerInput) {
  const { projects } = input;
  const queryClient = useQueryClient();

  // Lightweight read of automations to drive the sidebar attention badge. Shares the
  // ["automations"] query cache with the Automations route (and its live stream updates).
  const automationListQuery = useQuery({
    queryKey: automationQueryKey,
    queryFn: () => ensureNativeApi().automation.list({}),
  });
  useEffect(() => {
    const api = ensureNativeApi();
    return api.automation.onEvent((event) => {
      queryClient.setQueryData<AutomationListResult>(automationQueryKey, (prev) =>
        applyAutomationEvent(prev, event),
      );
    });
  }, [queryClient]);

  const automationAttentionBadge = useMemo(() => {
    const data = automationListQuery.data;
    if (!data) return null;
    const count = automationAttentionCount(data.runs);
    return count > 0
      ? {
          text: String(count),
          accessibleLabel: `${count} ${pluralize(count, "automation needs", "automations need")} attention`,
        }
      : null;
  }, [automationListQuery.data]);

  const pullRequestRepositoryConfig = useMemo(
    () => pullRequestRepositoryConfigFingerprint(projects),
    [projects],
  );
  const previousPullRequestRepositoryConfigRef = useRef(pullRequestRepositoryConfig);
  useEffect(() => {
    if (previousPullRequestRepositoryConfigRef.current === pullRequestRepositoryConfig) return;
    previousPullRequestRepositoryConfigRef.current = pullRequestRepositoryConfig;
    void queryClient.invalidateQueries({ queryKey: pullRequestQueryKeys.all });
  }, [pullRequestRepositoryConfig, queryClient]);

  // Count-only server query keeps rich pull-request rows off the wire and out of this cache.
  const pullRequestsReviewingQuery = useQuery({
    ...pullRequestReviewRequestCountQueryOptions({ projectId: null }),
    enabled: projects.some((project) => project.kind === "project"),
  });
  const pullRequestsReviewBadge = resolvePullRequestReviewBadge(pullRequestsReviewingQuery.data);

  // Heartbeat automations grouped by their target thread, so each thread row can show a
  // clock chip indicating an automation is attached (mirrors the Environment panel section).
  const automationsByThreadId = useMemo(
    () => groupHeartbeatAutomationsByTargetThread(automationListQuery.data?.definitions ?? []),
    [automationListQuery.data],
  );

  return {
    automationAttentionBadge,
    automationsByThreadId,
    pullRequestsReviewBadge,
  };
}

export type SidebarAttentionOwner = ReturnType<typeof useSidebarAttentionOwner>;
