import type { GitStatusResult, ThreadId } from "@agent-group/contracts";
import { useIsMutating, useMutation, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { toastManager } from "../ui/toast";
import { gitMutationKeys, gitPullMutationOptions } from "~/lib/gitReactQuery";
import { readNativeApi } from "~/nativeApi";

export function useGitRemoteActions(input: {
  gitCwd: string | null;
  gitStatus: GitStatusResult | null;
  queryClient: QueryClient;
  threadToastData: { readonly threadId: ThreadId } | undefined;
}) {
  const pullMutation = useMutation(
    gitPullMutationOptions({ cwd: input.gitCwd, queryClient: input.queryClient }),
  );
  const isPullRunning = useIsMutating({ mutationKey: gitMutationKeys.pull(input.gitCwd) }) > 0;

  const openExistingPr = useCallback(async () => {
    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
        data: input.threadToastData,
      });
      return;
    }
    const prUrl = input.gitStatus?.pr?.state === "open" ? input.gitStatus.pr.url : null;
    if (!prUrl) {
      toastManager.add({
        type: "error",
        title: "No open PR found.",
        data: input.threadToastData,
      });
      return;
    }
    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open PR link",
        description: error instanceof Error ? error.message : "An error occurred.",
        data: input.threadToastData,
      });
    });
  }, [input.gitStatus, input.threadToastData]);

  const runSyncWithRemote = useCallback(() => {
    const promise = pullMutation.mutateAsync();
    toastManager.promise(promise, {
      loading: { title: "Syncing with remote...", data: input.threadToastData },
      success: (result) => ({
        title: result.status === "pulled" ? "Remote synced" : "Already up to date",
        description:
          result.status === "pulled"
            ? `Updated ${result.branch} from ${result.upstreamBranch ?? "upstream"}`
            : `${result.branch} is already synchronized.`,
        data: input.threadToastData,
      }),
      error: (error) => ({
        title: "Sync failed",
        description: error instanceof Error ? error.message : "An error occurred.",
        data: input.threadToastData,
      }),
    });
    void promise.catch(() => undefined);
  }, [input.threadToastData, pullMutation]);

  return { isPullRunning, openExistingPr, runSyncWithRemote };
}

export type GitRemoteActions = ReturnType<typeof useGitRemoteActions>;
