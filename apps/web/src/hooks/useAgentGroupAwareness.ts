import type { AgentGroupOverview, ProjectId, ThreadId } from "@agent-group/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { toastManager } from "~/components/ui/toast";
import { agentGroupOverviewQueryOptions, serverQueryKeys } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";

export function useAgentGroupAwareness(groupId: ProjectId) {
  const queryClient = useQueryClient();
  const overviewQuery = useQuery(agentGroupOverviewQueryOptions(groupId));
  const [savingSessionIds, setSavingSessionIds] = useState<ReadonlySet<string>>(() => new Set());
  const awarenessBySessionId = useMemo(
    () =>
      new Map(
        (overviewQuery.data?.sessions ?? []).map((session) => [
          session.sessionId,
          session.contextAwarenessEnabled,
        ]),
      ),
    [overviewQuery.data?.sessions],
  );

  const toggleAwareness = useCallback(
    async (sessionId: ThreadId) => {
      if (savingSessionIds.has(sessionId)) return;
      let overview = overviewQuery.data;
      if (!overview) {
        overview = (await overviewQuery.refetch()).data;
        if (!overview) return;
      }
      const current =
        overview.sessions.find((session) => session.sessionId === sessionId)
          ?.contextAwarenessEnabled ?? overview.config.contextAwarenessDefaultEnabled;
      setSavingSessionIds((ids) => new Set(ids).add(sessionId));
      try {
        const document = await ensureNativeApi().agentGroup.updateSession({
          sessionId,
          contextAwarenessEnabled: !current,
          expectedRevision: overview.config.revision,
        });
        queryClient.setQueryData<AgentGroupOverview>(
          serverQueryKeys.agentGroupOverview(groupId),
          (cached) => ({
            config: document.config,
            sessions: [
              ...(cached?.sessions ?? overview.sessions).filter(
                (session) => session.sessionId !== document.session.sessionId,
              ),
              document.session,
            ],
          }),
        );
      } catch (error) {
        await overviewQuery.refetch();
        toastManager.add({
          type: "error",
          title: "Could not update Awareness",
          description: error instanceof Error ? error.message : undefined,
        });
      } finally {
        setSavingSessionIds((ids) => {
          const next = new Set(ids);
          next.delete(sessionId);
          return next;
        });
      }
    },
    [groupId, overviewQuery, queryClient, savingSessionIds],
  );

  return {
    awarenessBySessionId,
    awarenessDefaultEnabled: overviewQuery.data?.config.contextAwarenessDefaultEnabled ?? false,
    loading: overviewQuery.isLoading,
    savingSessionIds,
    toggleAwareness,
  };
}
