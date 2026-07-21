import type { ThreadId } from "@agent-group/contracts";
import { ThreadId as ThreadIdSchema } from "@agent-group/contracts";
import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";

import { useDiffRouteSearch } from "~/hooks/useDiffRouteSearch";
import { selectSplitView, useSplitViewStore } from "~/splitViewStore";
import {
  resolveVisibleToastThreadIds,
  shouldRenderToastForVisibleThreads,
} from "~/components/ui/toastRouteVisibility";
import type { ThreadToastData } from "./toastTypes";

export function shouldRenderForActiveThread(
  data: ThreadToastData | undefined,
  visibleThreadIds: ReadonlySet<ThreadId>,
): boolean {
  return shouldRenderToastForVisibleThreads({
    allowCrossThreadVisibility: data?.allowCrossThreadVisibility,
    toastThreadId: data?.threadId,
    visibleThreadIds,
  });
}

export function useVisibleThreadIdsFromRoute(): ReadonlySet<ThreadId> {
  const activeThreadId = useParams({
    strict: false,
    select: (params) =>
      typeof params.threadId === "string" ? ThreadIdSchema.makeUnsafe(params.threadId) : null,
  });
  const routeSearch = useDiffRouteSearch();
  const splitView = useSplitViewStore(selectSplitView(routeSearch.splitViewId ?? null));

  return useMemo(() => {
    return resolveVisibleToastThreadIds({ activeThreadId, splitView });
  }, [activeThreadId, splitView]);
}
