// FILE: useChatPanelRouteController.ts
// Purpose: Own Diff and Browser panel route transitions for a chat pane.
// Layer: Web chat navigation controller

import { type ThreadId } from "@agent-group/contracts";
import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";

import { stripDiffSearchParams, type ChatRightPanel } from "../diffRouteSearch";
import { readNativeApi } from "../nativeApi";
import { toastManager } from "../components/ui/toast";

type Navigate = ReturnType<typeof useNavigate>;

export function useChatPanelRouteController(input: {
  threadId: ThreadId;
  routePanel: ChatRightPanel | undefined;
  externalPanel: ChatRightPanel | null | undefined;
  diffEnvironmentPending: boolean;
  navigate: Navigate;
  onToggleDiffPanel?: (() => void) | undefined;
  onToggleBrowserPanel?: (() => void) | undefined;
  onOpenBrowserUrl?: ((url: string) => void) | undefined;
}) {
  const diffOpen = input.routePanel === "diff";
  const browserOpen = input.routePanel === "browser";
  const resolvedDiffOpen =
    input.externalPanel === undefined ? diffOpen : input.externalPanel === "diff";

  const toggleDiff = useCallback(() => {
    if (input.diffEnvironmentPending && !diffOpen) return;
    if (input.onToggleDiffPanel) {
      input.onToggleDiffPanel();
      return;
    }
    void input.navigate({
      to: "/$threadId",
      params: { threadId: input.threadId },
      replace: true,
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return diffOpen
          ? { ...rest, panel: undefined, diff: undefined }
          : { ...rest, panel: "diff", diff: "1" };
      },
    });
  }, [diffOpen, input]);

  const toggleBrowser = useCallback(() => {
    if (input.onToggleBrowserPanel) {
      input.onToggleBrowserPanel();
      return;
    }
    void input.navigate({
      to: "/$threadId",
      params: { threadId: input.threadId },
      replace: true,
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return browserOpen ? { ...rest, panel: undefined } : { ...rest, panel: "browser" };
      },
    });
  }, [browserOpen, input]);

  const openBrowserUrl = useCallback(
    (url: string) => {
      const api = readNativeApi();
      void api?.browser.open({ threadId: input.threadId, initialUrl: url }).catch((error) => {
        toastManager.add({
          type: "error",
          title: "Could not open repository",
          description:
            error instanceof Error ? error.message : "The in-app browser could not open GitHub.",
        });
      });
      if (input.onOpenBrowserUrl) {
        input.onOpenBrowserUrl(url);
        return;
      }
      void input.navigate({
        to: "/$threadId",
        params: { threadId: input.threadId },
        replace: true,
        search: (previous) => ({
          ...stripDiffSearchParams(previous),
          panel: "browser",
        }),
      });
    },
    [input],
  );

  return { diffOpen, resolvedDiffOpen, toggleDiff, toggleBrowser, openBrowserUrl };
}
