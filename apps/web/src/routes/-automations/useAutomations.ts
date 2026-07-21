// FILE: useAutomations.ts
// Purpose: Owns automation queries, mutations, live reconciliation, and run grouping.
// Layer: Automation web data controller

import type {
  AutomationCreateInput,
  AutomationDefinition,
  AutomationListResult,
  AutomationRun,
  AutomationUpdateInput,
  ThreadId,
} from "@agent-group/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { toastManager } from "~/components/ui/toast";
import { ensureNativeApi } from "~/nativeApi";
import { EMPTY_AUTOMATION_LIST, applyAutomationEvent, automationQueryKey } from "./automationCache";

export function useAutomations(onRunStarted?: (threadId: ThreadId) => void) {
  const queryClient = useQueryClient();
  const automationsQuery = useQuery({
    queryKey: automationQueryKey,
    queryFn: () => ensureNativeApi().automation.list({}),
  });
  const data = automationsQuery.data ?? EMPTY_AUTOMATION_LIST;

  useEffect(() => {
    const api = ensureNativeApi();
    return api.automation.onEvent((event) => {
      queryClient.setQueryData<AutomationListResult>(automationQueryKey, (prev) =>
        applyAutomationEvent(prev, event),
      );
    });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (input: AutomationCreateInput) => ensureNativeApi().automation.create(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error) => toastManager.add({ type: "error", title: error.message }),
  });
  const updateMutation = useMutation({
    mutationFn: (input: AutomationUpdateInput) => ensureNativeApi().automation.update(input),
    onMutate: (input) => {
      const previous = queryClient.getQueryData<AutomationListResult>(automationQueryKey);
      queryClient.setQueryData<AutomationListResult>(automationQueryKey, (prev) => {
        const base = prev ?? EMPTY_AUTOMATION_LIST;
        return {
          definitions: base.definitions.map((definition) =>
            definition.id === input.id
              ? ({ ...definition, ...input } as AutomationDefinition)
              : definition,
          ),
          runs: base.runs,
        };
      });
      return { previous };
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData<AutomationListResult>(automationQueryKey, context.previous);
      }
      toastManager.add({ type: "error", title: error.message });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (definition: AutomationDefinition) =>
      ensureNativeApi().automation.delete({ id: definition.id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error) => toastManager.add({ type: "error", title: error.message }),
  });
  const runNowMutation = useMutation({
    mutationFn: (definition: AutomationDefinition) =>
      ensureNativeApi().automation.runNow({ automationId: definition.id }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: automationQueryKey });
      if (result.run.threadId) onRunStarted?.(result.run.threadId);
    },
    onError: (error) => toastManager.add({ type: "error", title: error.message }),
  });
  const cancelRunMutation = useMutation({
    mutationFn: (run: AutomationRun) => ensureNativeApi().automation.cancelRun({ runId: run.id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error) => toastManager.add({ type: "error", title: error.message }),
  });
  const markRunReadMutation = useMutation({
    mutationFn: (input: { readonly run: AutomationRun; readonly unread: boolean }) =>
      ensureNativeApi().automation.markRunRead({ runId: input.run.id, unread: input.unread }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error) => toastManager.add({ type: "error", title: error.message }),
  });
  const archiveRunMutation = useMutation({
    mutationFn: (input: { readonly run: AutomationRun; readonly archived: boolean }) =>
      ensureNativeApi().automation.archiveRun({ runId: input.run.id, archived: input.archived }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error) => toastManager.add({ type: "error", title: error.message }),
  });

  const runsByAutomationId = useMemo(() => {
    const map = new Map<string, AutomationRun[]>();
    for (const run of data.runs) {
      const runs = map.get(run.automationId) ?? [];
      runs.push(run);
      map.set(run.automationId, runs);
    }
    for (const runs of map.values()) {
      runs.sort((left, right) => right.scheduledFor.localeCompare(left.scheduledFor));
    }
    return map;
  }, [data.runs]);

  return {
    data,
    isLoading: automationsQuery.isLoading,
    refetch: automationsQuery.refetch,
    createMutation,
    updateMutation,
    deleteMutation,
    runNowMutation,
    cancelRunMutation,
    markRunReadMutation,
    archiveRunMutation,
    runsByAutomationId,
  };
}
