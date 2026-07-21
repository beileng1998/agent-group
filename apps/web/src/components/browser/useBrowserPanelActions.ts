// FILE: useBrowserPanelActions.ts
// Purpose: Owns user-triggered browser panel actions and copy-link notifications.
// Layer: Desktop-only browser component controller

import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type BrowserTabState,
  type NativeApi,
  type ThreadBrowserState,
  type ThreadId,
} from "@agent-group/contracts";
import { resolveCopyableBrowserTabUrl } from "@agent-group/shared/browserSession";
import {
  BROWSER_COPY_LINK_TOAST_TITLE,
  isBrowserCopyLinkChord,
} from "@agent-group/shared/browserShortcuts";

import { isElectron } from "~/env";
import { IMAGE_SIZE_LIMIT_LABEL } from "~/lib/composerSend";
import { isMacPlatform } from "~/lib/utils";
import type { ComposerImageAttachment } from "../../composerDraftStore";
import {
  composerImageFromBrowserScreenshot,
  screenshotAttachmentName,
} from "../../lib/browserPromptContext";
import { anchoredToastManager, toastManager } from "../ui/toast";

export type RunBrowserAction = <T>(action: () => Promise<T>) => Promise<T | null>;

export interface BrowserPanelActionRuntime {
  api: NativeApi | undefined;
  threadId: ThreadId;
  isLive: boolean;
  ensureLive: () => boolean;
  run: RunBrowserAction;
  upsertState: (state: ThreadBrowserState) => void;
}

export interface BrowserPanelActionAddress {
  activeTab: BrowserTabState | null;
  inputRef: RefObject<HTMLInputElement | null>;
}

export interface BrowserPanelActionInputs {
  closePanel: () => void;
  setLocalError: (error: string | null) => void;
  composerDraft: {
    imageCount: number;
    fileCount: number;
    assistantSelectionCount: number;
    addImage: (threadId: ThreadId, image: ComposerImageAttachment) => void;
  };
}

export interface BrowserPanelActions {
  selectTab: (tabId: string) => void;
  createTab: () => void;
  closeTab: (tabId: string) => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  captureScreenshot: () => void;
  copyScreenshotToClipboard: () => void;
  copyActiveTabLink: () => void;
  openExternal: () => void;
  closePanel: () => void;
  copyScreenshotButtonRef: RefObject<HTMLButtonElement | null>;
}

export function useBrowserPanelActions({
  runtime,
  address,
  actions,
}: {
  runtime: BrowserPanelActionRuntime;
  address: BrowserPanelActionAddress;
  actions: BrowserPanelActionInputs;
}): BrowserPanelActions {
  const { activeTab, inputRef } = address;
  const { api, ensureLive, isLive, run, threadId, upsertState } = runtime;
  const { closePanel, composerDraft, setLocalError } = actions;
  const copyScreenshotButtonRef = useRef<HTMLButtonElement>(null);

  const applyTabState = useCallback(
    (state: ThreadBrowserState | null) => {
      if (state) {
        upsertState(state);
      }
    },
    [upsertState],
  );

  const selectTab = useCallback(
    (tabId: string) => {
      if (!ensureLive() || !api) {
        return;
      }
      void run(() => api.browser.selectTab({ threadId, tabId })).then(applyTabState);
    },
    [api, applyTabState, ensureLive, run, threadId],
  );

  const createTab = useCallback(() => {
    if (!ensureLive() || !api) {
      return;
    }
    void run(() => api.browser.newTab({ threadId, activate: true })).then((state) => {
      applyTabState(state);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    });
  }, [api, applyTabState, ensureLive, inputRef, run, threadId]);

  const closeTab = useCallback(
    (tabId: string) => {
      if (!ensureLive() || !api) {
        return;
      }
      void run(() => api.browser.closeTab({ threadId, tabId })).then((state) => {
        if (!state) {
          return;
        }
        upsertState(state);
        if (!state.open && state.tabs.length === 0) {
          closePanel();
        }
      });
    },
    [api, closePanel, ensureLive, run, threadId, upsertState],
  );

  const goBack = useCallback(() => {
    if (!ensureLive() || !api || !activeTab) {
      return;
    }
    void run(() => api.browser.goBack({ threadId, tabId: activeTab.id })).then(applyTabState);
  }, [activeTab, api, applyTabState, ensureLive, run, threadId]);

  const goForward = useCallback(() => {
    if (!ensureLive() || !api || !activeTab) {
      return;
    }
    void run(() => api.browser.goForward({ threadId, tabId: activeTab.id })).then(applyTabState);
  }, [activeTab, api, applyTabState, ensureLive, run, threadId]);

  const reload = useCallback(() => {
    if (!ensureLive() || !api || !activeTab) {
      return;
    }
    void run(() => api.browser.reload({ threadId, tabId: activeTab.id })).then(applyTabState);
  }, [activeTab, api, applyTabState, ensureLive, run, threadId]);

  const captureScreenshot = useCallback(() => {
    if (!ensureLive() || !api || !activeTab) {
      return;
    }

    const attachmentCount =
      composerDraft.imageCount + composerDraft.fileCount + composerDraft.assistantSelectionCount;
    if (attachmentCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      setLocalError(
        `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} references per message.`,
      );
      return;
    }

    void run(() => api.browser.captureScreenshot({ threadId, tabId: activeTab.id })).then(
      (screenshot) => {
        if (!screenshot) {
          return;
        }
        if (screenshot.sizeBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
          setLocalError(
            `'${screenshotAttachmentName(screenshot)}' exceeds the ${IMAGE_SIZE_LIMIT_LABEL} attachment limit.`,
          );
          return;
        }

        composerDraft.addImage(threadId, composerImageFromBrowserScreenshot(screenshot));
        setLocalError(null);
      },
    );
  }, [activeTab, api, composerDraft, ensureLive, run, setLocalError, threadId]);

  const copyScreenshotToClipboard = useCallback(() => {
    if (!ensureLive() || !api || !activeTab) {
      return;
    }

    void run(() => api.browser.copyScreenshotToClipboard({ threadId, tabId: activeTab.id })).then(
      (result) => {
        if (result === null) {
          return;
        }
        const anchor = copyScreenshotButtonRef.current;
        if (anchor) {
          anchoredToastManager.add({
            data: { tooltipStyle: true },
            positionerProps: { anchor },
            timeout: 1_200,
            title: "Browser screenshot copied",
          });
          return;
        }

        toastManager.add({ type: "success", title: "Browser screenshot copied" });
      },
    );
  }, [activeTab, api, ensureLive, run, threadId]);

  const copyActiveTabLink = useCallback(() => {
    if (!activeTab) {
      return;
    }
    // Native clipboard remains authoritative while the WebContentsView owns focus.
    if (isElectron && api) {
      void run(() => api.browser.copyLink({ threadId, tabId: activeTab.id }));
      return;
    }
    const url = resolveCopyableBrowserTabUrl(activeTab);
    if (!url) {
      return;
    }
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (!clipboard) {
      return;
    }
    void clipboard.writeText(url).then(
      () => {
        toastManager.add({ type: "success", title: BROWSER_COPY_LINK_TOAST_TITLE });
      },
      () => {
        // Clipboard writes can reject without user gesture; nothing actionable to surface.
      },
    );
  }, [activeTab, api, run, threadId]);

  useEffect(() => {
    if (!isLive) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const matches = isBrowserCopyLinkChord(
        {
          meta: event.metaKey,
          ctrl: event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
          key: event.key,
        },
        isMacPlatform(navigator.platform),
      );
      if (!matches) {
        return;
      }
      event.preventDefault();
      copyActiveTabLink();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [copyActiveTabLink, isLive]);

  useEffect(() => {
    if (!api || !isLive) {
      return;
    }
    return api.browser.onCopyLink((event) => {
      if (event.threadId !== threadId) {
        return;
      }
      toastManager.add({ type: "success", title: BROWSER_COPY_LINK_TOAST_TITLE });
    });
  }, [api, isLive, threadId]);

  const openExternal = useCallback(() => {
    if (!ensureLive() || !api || !activeTab) {
      return;
    }
    // Keep the original behavior: shell navigation is intentionally not wrapped in run().
    void api.shell.openExternal(activeTab.url);
  }, [activeTab, api, ensureLive]);

  return useMemo(
    () => ({
      selectTab,
      createTab,
      closeTab,
      goBack,
      goForward,
      reload,
      captureScreenshot,
      copyScreenshotToClipboard,
      copyActiveTabLink,
      openExternal,
      closePanel,
      copyScreenshotButtonRef,
    }),
    [
      captureScreenshot,
      closePanel,
      closeTab,
      copyActiveTabLink,
      copyScreenshotToClipboard,
      createTab,
      goBack,
      goForward,
      openExternal,
      reload,
      selectTab,
    ],
  );
}
