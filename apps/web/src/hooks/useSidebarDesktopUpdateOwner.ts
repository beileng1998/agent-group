// FILE: useSidebarDesktopUpdateOwner.ts
// Purpose: Own desktop update subscription, actions, error surfacing, and sidebar presentation state.
// Layer: Web sidebar orchestration owner

import type { DesktopUpdateState } from "@agent-group/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { persistAppStateNow } from "../store";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateAlreadyCurrentNotice,
  getDesktopUpdateButtonPresentation,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateDownloadPercent,
  getDesktopUpdateErrorSignature,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldRecommendManualDesktopDownload,
  shouldShowArm64IntelBuildWarning,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "../components/desktopUpdate.logic";
import { toastManager } from "../components/ui/toast";

export function useSidebarDesktopUpdateOwner() {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [installing, setInstalling] = useState(false);
  const lastErrorToastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }
    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setState(nextState);
    });
    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setState(nextState);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const surfaceError = useCallback(
    (input: { title: string; description: string; state: DesktopUpdateState | null }) => {
      const signature = getDesktopUpdateErrorSignature(input.state) ?? `adhoc:${input.description}`;
      if (lastErrorToastSignatureRef.current === signature) return;
      lastErrorToastSignatureRef.current = signature;
      const releaseUrl = input.state?.releaseUrl ?? null;
      const recommendManualDownload = shouldRecommendManualDesktopDownload(input.state);
      const fallbackProps = releaseUrl
        ? {
            data: { copyText: releaseUrl },
            actionProps: {
              children: "Download manually",
              onClick: () => {
                void window.desktopBridge?.openExternal(releaseUrl);
              },
            },
          }
        : {};
      toastManager.add({
        type: "error",
        title: recommendManualDownload ? "Download the update manually" : input.title,
        description: recommendManualDownload
          ? `Automatic installation has failed ${input.state?.installFailureCount ?? 0} times. Download ${input.state?.availableVersion ?? "the update"} manually to finish updating.`
          : input.description,
        ...fallbackProps,
      });
    },
    [],
  );

  useEffect(() => {
    if (!getDesktopUpdateErrorSignature(state)) {
      lastErrorToastSignatureRef.current = null;
      return;
    }
    if (!state?.releaseUrl) return;
    surfaceError({
      title:
        state.errorContext === "install"
          ? "Couldn’t finish updating"
          : "Couldn’t download the update",
      description:
        state.message ?? "The in-app update could not complete. You can download it manually.",
      state,
    });
  }, [state, surfaceError]);

  const disabled = isDesktopUpdateButtonDisabled(state) || installing;
  const action = state ? resolveDesktopUpdateButtonAction(state) : "none";
  const presentation = getDesktopUpdateButtonPresentation(state, { installing });
  const onAction = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !state || disabled || action === "none") return;
    if (action === "check") {
      void bridge
        .checkForUpdates()
        .then((nextState) => {
          setInstalling(false);
          setState(nextState);
          if (nextState.status === "available") {
            toastManager.add({
              type: "info",
              title: "Preparing update",
              description: `Agent Group is preparing version ${nextState.availableVersion ?? "available"} in the background.`,
            });
            return;
          }
          if (nextState.status === "downloading") {
            toastManager.add({
              type: "info",
              title: "Preparing update",
              description: "Agent Group is downloading the update in the background.",
            });
            return;
          }
          if (nextState.status === "downloaded") {
            toastManager.add({
              type: "success",
              title: "Update ready",
              description: "Click Update when you’re ready to restart and install it.",
            });
            return;
          }
          if (nextState.status === "up-to-date") {
            toastManager.add({
              type: "info",
              title: "You're up to date",
              description: `Agent Group ${nextState.currentVersion} is already the newest version.`,
            });
            return;
          }
          if (nextState.status === "error") {
            surfaceError({
              title: "Could not check for updates",
              description: nextState.message ?? "An unexpected error occurred.",
              state: nextState,
            });
          }
        })
        .catch((error) => {
          surfaceError({
            title: "Could not check for updates",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
            state,
          });
        });
      return;
    }
    if (action === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          setInstalling(false);
          setState(result.state);
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update ready",
              description: "Click Update when you’re ready to restart and install it.",
            });
          }
          const alreadyCurrentNotice = getDesktopUpdateAlreadyCurrentNotice(result);
          if (alreadyCurrentNotice) {
            toastManager.add({
              type: "info",
              title: "Already up to date",
              description: alreadyCurrentNotice,
            });
            return;
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          surfaceError({
            title: "Could not download update",
            description: actionError,
            state: result.state,
          });
        })
        .catch((error) => {
          surfaceError({
            title: "Could not start update download",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
            state,
          });
        });
      return;
    }
    if (action === "install") {
      setInstalling(true);
      persistAppStateNow();
      void bridge
        .installUpdate()
        .then((result) => {
          setState(result.state);
          setInstalling(false);
          const alreadyCurrentNotice = getDesktopUpdateAlreadyCurrentNotice(result);
          if (alreadyCurrentNotice) {
            toastManager.add({
              type: "info",
              title: "Already up to date",
              description: alreadyCurrentNotice,
            });
            return;
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          surfaceError({
            title: "Could not install update",
            description: actionError,
            state: result.state,
          });
        })
        .catch((error) => {
          setInstalling(false);
          surfaceError({
            title: "Could not install update",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
            state,
          });
        });
    }
  }, [action, disabled, state, surfaceError]);

  const showWarning = isElectron && shouldShowArm64IntelBuildWarning(state);
  const warningDescription =
    state && showWarning ? getArm64IntelBuildWarningDescription(state) : null;
  const interactivityClasses = disabled ? "cursor-not-allowed opacity-60" : "hover:brightness-110";
  const downloadPercent = getDesktopUpdateDownloadPercent(state);
  const buttonClassName = cn(
    "inline-flex h-6 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[var(--info)] px-2.5 font-system-ui text-[length:var(--app-font-size-ui-xs,10px)] font-medium leading-none text-white transition-colors",
    presentation.secondaryLabel !== null && "min-h-6 py-0.5",
    interactivityClasses,
  );

  return {
    warning: {
      visible: showWarning && warningDescription !== null,
      description: warningDescription,
      actionLabel:
        action === "download"
          ? "Preparing ARM build"
          : action === "install"
            ? "Update ARM build"
            : "Check for ARM build update",
      actionVisible: action !== "none",
      disabled,
      onAction,
    },
    button: {
      visible: isElectron && shouldShowDesktopUpdateButton(state),
      tooltip: state ? getDesktopUpdateButtonTooltip(state, { installing }) : "Update available",
      disabled,
      className: buttonClassName,
      label: presentation.label,
      secondaryLabel: presentation.secondaryLabel,
      downloadPercent,
      onAction,
    },
  };
}

export type SidebarDesktopUpdateOwner = ReturnType<typeof useSidebarDesktopUpdateOwner>;
