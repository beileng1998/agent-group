// FILE: useBrowserAddressController.ts
// Purpose: Owns browser address drafts, tab synchronization, and address navigation.
// Layer: Browser panel controller

import type { BrowserTabState, NativeApi, ThreadBrowserState, ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { BrowserHistoryEntry } from "../../browserStateStore";
import {
  browserAddressDisplayValue,
  buildBrowserAddressSuggestions,
  normalizeBrowserAddressInput,
  resolveBrowserAddressSync,
  type BrowserAddressSuggestion,
} from "../BrowserPanel.logic";
import type { BrowserActionRunner } from "./useBrowserRuntimeSession";

export interface BrowserAddressController {
  addressInputRef: RefObject<HTMLInputElement | null>;
  addressValue: string;
  isAddressFocused: boolean;
  suggestions: BrowserAddressSuggestion[];
  showSuggestions: boolean;
  changeAddress: (value: string) => void;
  focusAddress: () => void;
  blurAddress: () => void;
  submitAddress: () => void;
  chooseSuggestion: (suggestion: BrowserAddressSuggestion) => void;
  openLocalServer: (url: string, tabId: string | null) => void;
  createTab: () => void;
}

export function useBrowserAddressController(input: {
  api: NativeApi | undefined;
  threadId: ThreadId;
  isLiveRuntime: boolean;
  runtimeReady: boolean;
  activeTab: BrowserTabState | null;
  tabs: BrowserTabState[];
  recentHistory: BrowserHistoryEntry[];
  requestLiveRuntime: () => void;
  ensureLiveRuntime: () => boolean;
  runBrowserAction: BrowserActionRunner;
  upsertThreadState: (state: ThreadBrowserState) => void;
}): BrowserAddressController {
  const {
    activeTab,
    api,
    ensureLiveRuntime,
    isLiveRuntime,
    recentHistory,
    requestLiveRuntime,
    runBrowserAction,
    runtimeReady,
    tabs,
    threadId,
    upsertThreadState,
  } = input;
  const addressInputRef = useRef<HTMLInputElement>(null);
  const addressDraftsByTabIdRef = useRef(new Map<string, string>());
  const lastSyncedAddressByTabIdRef = useRef(new Map<string, string>());
  const previousActiveTabIdRef = useRef<string | null>(null);
  const isAddressEditingRef = useRef(false);
  const [addressValue, setAddressValue] = useState("");
  const [isAddressFocused, setIsAddressFocused] = useState(false);

  const suggestions = buildBrowserAddressSuggestions({
    query: addressValue,
    activeTabId: activeTab?.id ?? null,
    tabs,
    recentHistory,
  });
  const showSuggestions =
    isLiveRuntime && isAddressFocused && suggestions.length > 0 && runtimeReady;

  useEffect(() => {
    const activeTabId = activeTab?.id ?? null;
    const nextDisplayValue = browserAddressDisplayValue(activeTab);
    const decision = resolveBrowserAddressSync({
      activeTabId,
      previousActiveTabId: previousActiveTabIdRef.current,
      savedDraft: activeTabId ? addressDraftsByTabIdRef.current.get(activeTabId) : undefined,
      nextDisplayValue,
      lastSyncedValue: activeTabId
        ? lastSyncedAddressByTabIdRef.current.get(activeTabId)
        : undefined,
      isEditing: isAddressEditingRef.current,
    });

    if (decision.type === "replace") {
      setAddressValue(decision.value);
      if (activeTabId) {
        addressDraftsByTabIdRef.current.set(activeTabId, decision.value);
        if (decision.syncedValue !== undefined) {
          lastSyncedAddressByTabIdRef.current.set(activeTabId, decision.syncedValue);
        }
      }
    }

    previousActiveTabIdRef.current = activeTabId;
  }, [activeTab]);

  useEffect(() => {
    const liveTabIds = new Set(tabs.map((tab) => tab.id));
    for (const tabId of addressDraftsByTabIdRef.current.keys()) {
      if (!liveTabIds.has(tabId)) {
        addressDraftsByTabIdRef.current.delete(tabId);
        lastSyncedAddressByTabIdRef.current.delete(tabId);
      }
    }
  }, [tabs]);

  const changeAddress = useCallback(
    (value: string) => {
      if (!isLiveRuntime) {
        requestLiveRuntime();
      }
      isAddressEditingRef.current = true;
      setAddressValue(value);
      if (activeTab) {
        addressDraftsByTabIdRef.current.set(activeTab.id, value);
      }
    },
    [activeTab, isLiveRuntime, requestLiveRuntime],
  );

  const focusAddress = useCallback(() => {
    if (!isLiveRuntime) {
      requestLiveRuntime();
    }
    isAddressEditingRef.current = true;
    setIsAddressFocused(true);
  }, [isLiveRuntime, requestLiveRuntime]);

  const blurAddress = useCallback(() => {
    isAddressEditingRef.current = false;
    setIsAddressFocused(false);
  }, []);

  const submitAddress = useCallback(() => {
    if (!ensureLiveRuntime()) {
      return;
    }
    if (!api || !activeTab) {
      return;
    }
    isAddressEditingRef.current = false;
    setIsAddressFocused(false);
    const normalizedAddress = normalizeBrowserAddressInput(addressValue);
    addressDraftsByTabIdRef.current.set(activeTab.id, normalizedAddress);
    setAddressValue(normalizedAddress);
    void runBrowserAction(() =>
      api.browser.navigate({
        threadId,
        tabId: activeTab.id,
        url: normalizedAddress,
      }),
    ).then((state) => {
      if (state) {
        upsertThreadState(state);
      }
    });
  }, [
    activeTab,
    addressValue,
    api,
    ensureLiveRuntime,
    runBrowserAction,
    threadId,
    upsertThreadState,
  ]);

  const chooseSuggestion = useCallback(
    (suggestion: BrowserAddressSuggestion) => {
      if (!api) {
        return;
      }
      if (!ensureLiveRuntime()) {
        return;
      }

      isAddressEditingRef.current = false;
      setIsAddressFocused(false);
      setAddressValue(suggestion.url);

      const tabId = suggestion.tabId;
      if (suggestion.kind === "tab" && typeof tabId === "string") {
        void runBrowserAction(() => api.browser.selectTab({ threadId, tabId })).then((state) => {
          if (state) {
            upsertThreadState(state);
          }
          window.requestAnimationFrame(() => {
            addressInputRef.current?.focus();
            addressInputRef.current?.select();
          });
        });
        return;
      }

      if (activeTab) {
        addressDraftsByTabIdRef.current.set(activeTab.id, suggestion.url);
      }

      void runBrowserAction(() =>
        api.browser.navigate({
          threadId,
          url: suggestion.url,
          ...(activeTab ? { tabId: activeTab.id } : {}),
        }),
      ).then((state) => {
        if (state) {
          upsertThreadState(state);
        }
      });
    },
    [activeTab, api, ensureLiveRuntime, runBrowserAction, threadId, upsertThreadState],
  );

  const openLocalServer = useCallback(
    (url: string, tabId: string | null) => {
      if (!api) {
        return;
      }
      if (!ensureLiveRuntime()) {
        return;
      }

      isAddressEditingRef.current = false;
      setIsAddressFocused(false);
      setAddressValue(url);
      if (tabId) {
        addressDraftsByTabIdRef.current.set(tabId, url);
      }

      void runBrowserAction(() =>
        api.browser.navigate({
          threadId,
          url,
          ...(tabId ? { tabId } : {}),
        }),
      ).then((state) => {
        if (state) {
          upsertThreadState(state);
        }
      });
    },
    [api, ensureLiveRuntime, runBrowserAction, threadId, upsertThreadState],
  );

  const createTab = useCallback(() => {
    if (!ensureLiveRuntime()) {
      return;
    }
    if (!api) {
      return;
    }
    void runBrowserAction(() => api.browser.newTab({ threadId, activate: true })).then((state) => {
      if (state) {
        upsertThreadState(state);
      }
      window.requestAnimationFrame(() => {
        addressInputRef.current?.focus();
        addressInputRef.current?.select();
      });
    });
  }, [api, ensureLiveRuntime, runBrowserAction, threadId, upsertThreadState]);

  return {
    addressInputRef,
    addressValue,
    isAddressFocused,
    suggestions,
    showSuggestions,
    changeAddress,
    focusAddress,
    blurAddress,
    submitAddress,
    chooseSuggestion,
    openLocalServer,
    createTab,
  };
}
