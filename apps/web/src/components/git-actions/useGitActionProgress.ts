import type { GitActionProgressEvent, ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useRef } from "react";

import { formatClockDuration } from "~/session-logic";
import { readNativeApi } from "~/nativeApi";
import { toastManager } from "../ui/toast";
import type { ActiveGitActionProgress } from "./gitActionsTypes";

function formatElapsedDescription(startedAtMs: number | null): string | undefined {
  if (startedAtMs === null) return undefined;
  return `Running for ${formatClockDuration(Date.now() - startedAtMs)}`;
}

function resolveProgressDescription(progress: ActiveGitActionProgress): string | undefined {
  if (progress.lastOutputLine) return progress.lastOutputLine;
  return formatElapsedDescription(progress.hookStartedAtMs ?? progress.phaseStartedAtMs);
}

export function useGitActionProgress(input: {
  gitCwd: string | null;
  threadToastData: { readonly threadId: ThreadId } | undefined;
}) {
  const activeProgressRef = useRef<ActiveGitActionProgress | null>(null);

  const updateProgressToast = useCallback(() => {
    const progress = activeProgressRef.current;
    if (!progress) return;
    toastManager.update(progress.toastId, {
      type: "loading",
      title: progress.title,
      description: resolveProgressDescription(progress),
      timeout: 0,
      data: input.threadToastData,
    });
  }, [input.threadToastData]);

  useEffect(() => {
    const api = readNativeApi();
    if (!api) return;

    const applyProgressEvent = (event: GitActionProgressEvent) => {
      const progress = activeProgressRef.current;
      if (!progress || (input.gitCwd && event.cwd !== input.gitCwd)) return;
      if (progress.actionId !== event.actionId) return;

      const now = Date.now();
      switch (event.kind) {
        case "action_started":
          progress.phaseStartedAtMs = now;
          progress.hookStartedAtMs = null;
          progress.hookName = null;
          progress.lastOutputLine = null;
          break;
        case "phase_started":
          progress.title = event.label;
          progress.currentPhaseLabel = event.label;
          progress.phaseStartedAtMs = now;
          progress.hookStartedAtMs = null;
          progress.hookName = null;
          progress.lastOutputLine = null;
          break;
        case "hook_started":
          progress.title = `Running ${event.hookName}...`;
          progress.hookName = event.hookName;
          progress.hookStartedAtMs = now;
          progress.lastOutputLine = null;
          break;
        case "hook_output":
          progress.lastOutputLine = event.text;
          break;
        case "hook_finished":
          progress.title = progress.currentPhaseLabel ?? "Committing...";
          progress.hookName = null;
          progress.hookStartedAtMs = null;
          progress.lastOutputLine = null;
          break;
        case "action_finished":
        case "action_failed":
          return;
      }
      updateProgressToast();
    };

    return api.git.onActionProgress(applyProgressEvent);
  }, [input.gitCwd, updateProgressToast]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (activeProgressRef.current) updateProgressToast();
    }, 1000);
    return () => window.clearInterval(interval);
  }, [updateProgressToast]);

  return activeProgressRef;
}
