import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { toastManager } from "../components/ui/toast";
import { deleteArchivedThreadsFromClient } from "../lib/archivedThreadDelete";
import { gitRemoveWorktreeMutationOptions } from "../lib/gitReactQuery";
import { serverQueryKeys, serverWorktreesQueryOptions } from "../lib/serverReactQuery";
import { pluralize } from "@agent-group/shared/text";
import { ensureNativeApi, readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import type { ThreadShell } from "../types";
import { formatWorktreePathForDisplay } from "../worktreeCleanup";
import { normalizeManagedWorktreePath } from "./-settingsRoute.providerCatalog";
import type { SettingsWorktreeGroup } from "./-settingsRoute.worktreesPanel";

export function useManagedWorktreesController(input: {
  active: boolean;
  threadShells: ReadonlyArray<ThreadShell>;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...serverWorktreesQueryOptions(),
    enabled: input.active,
  });
  const removeMutation = useMutation(gitRemoveWorktreeMutationOptions({ queryClient }));
  const removeDeletedThreadFromClientState = useStore(
    (store) => store.removeDeletedThreadFromClientState,
  );

  const groups = useMemo(() => {
    const result: SettingsWorktreeGroup[] = [];
    const groupByRoot = new Map<string, SettingsWorktreeGroup>();
    for (const worktree of query.data?.worktrees ?? []) {
      const linkedThreads = input.threadShells.filter((thread) => {
        const candidatePaths = [
          normalizeManagedWorktreePath(thread.worktreePath),
          normalizeManagedWorktreePath(thread.associatedWorktreePath),
        ];
        return candidatePaths.includes(worktree.path);
      });
      const nextWorktree = { path: worktree.path, linkedThreads };
      const existingGroup = groupByRoot.get(worktree.workspaceRoot);
      if (existingGroup) {
        existingGroup.worktrees = [...existingGroup.worktrees, nextWorktree];
      } else {
        const group: SettingsWorktreeGroup = {
          workspaceRoot: worktree.workspaceRoot,
          worktrees: [nextWorktree],
        };
        result.push(group);
        groupByRoot.set(worktree.workspaceRoot, group);
      }
    }
    return result;
  }, [input.threadShells, query.data?.worktrees]);

  const deleteManagedWorktree = useCallback(
    async (target: { workspaceRoot: string; worktreePath: string }) => {
      const api = readNativeApi() ?? ensureNativeApi();
      const displayName = formatWorktreePathForDisplay(target.worktreePath);
      const snapshot = await api.orchestration.getShellSnapshot().catch(() => null);
      if (snapshot === null) {
        toastManager.add({
          type: "error",
          title: "Could not verify linked conversations",
          description: "Retry once the app reconnects to the server.",
        });
        return;
      }

      const linkedThreads = snapshot.threads.filter((thread) => {
        const candidatePaths = [
          normalizeManagedWorktreePath(thread.worktreePath),
          normalizeManagedWorktreePath(thread.associatedWorktreePath ?? null),
        ];
        return candidatePaths.includes(target.worktreePath);
      });
      const archivedIds = linkedThreads
        .filter((thread) => (thread.archivedAt ?? null) !== null)
        .map((thread) => thread.id);
      const activeCount = linkedThreads.filter(
        (thread) => (thread.archivedAt ?? null) === null,
      ).length;
      const conversationCount = activeCount + archivedIds.length;
      const confirmed = await api.dialogs.confirm(
        conversationCount > 0
          ? [
              `Delete worktree "${displayName}"?`,
              "",
              `${activeCount} active and ${archivedIds.length} archived ${pluralize(conversationCount, "conversation is", "conversations are")} linked to this worktree.`,
              archivedIds.length > 0
                ? "Archived conversations will be deleted first."
                : "Deleting it can break reopening those chats in the same workspace.",
              "",
              "Delete the worktree anyway?",
            ].join("\n")
          : [`Delete worktree "${displayName}"?`, "This removes the Git worktree from disk."].join(
              "\n",
            ),
      );
      if (!confirmed) return;

      try {
        await deleteArchivedThreadsFromClient({
          api: api.orchestration,
          threadIds: archivedIds,
          removeDeletedThreadFromClientState,
        });
        await removeMutation.mutateAsync({
          cwd: target.workspaceRoot,
          path: target.worktreePath,
          force: true,
        });
        await queryClient.invalidateQueries({ queryKey: serverQueryKeys.worktrees() });
        toastManager.add({
          type: "success",
          title: "Worktree deleted",
          description:
            archivedIds.length > 0
              ? `${displayName} was removed and ${archivedIds.length} archived ${pluralize(archivedIds.length, "conversation")} were deleted.`
              : `${displayName} was removed.`,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not delete worktree",
          description: error instanceof Error ? error.message : "Unable to delete the worktree.",
        });
      }
    },
    [queryClient, removeDeletedThreadFromClientState, removeMutation],
  );

  return {
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    groups,
    deletePending: removeMutation.isPending,
    deleteManagedWorktree,
  };
}
