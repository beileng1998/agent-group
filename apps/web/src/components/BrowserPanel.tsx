// FILE: BrowserPanel.tsx
// Purpose: Composes the in-app browser state owners and presentation surfaces.
// Layer: Desktop-only React component

import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ThreadId } from "@agent-group/contracts";
import { isBlankBrowserTabUrl } from "@agent-group/shared/browserSession";

import type { DockPaneRuntimeMode } from "~/lib/dockPaneActivation";
import { serverLocalServersQueryOptions } from "~/lib/serverReactQuery";
import { readNativeApi } from "~/nativeApi";

import {
  selectThreadBrowserHistory,
  selectThreadBrowserState,
  useBrowserStateStore,
} from "../browserStateStore";
import { useComposerDraftStore } from "../composerDraftStore";
import { resolveBrowserChromeStatus } from "./BrowserPanel.logic";
import { BrowserPanelChrome } from "./BrowserPanelChrome";
import { BrowserPanelContent } from "./BrowserPanelContent";
import { useBrowserAddressController } from "./browser/useBrowserAddressController";
import { useBrowserNativeViewport } from "./browser/useBrowserNativeViewport";
import { useBrowserPanelActions } from "./browser/useBrowserPanelActions";
import { useBrowserRuntimeSession } from "./browser/useBrowserRuntimeSession";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";

interface BrowserPanelProps {
  mode: DiffPanelMode;
  threadId: ThreadId;
  onClosePanel: () => void;
  runtimeMode?: DockPaneRuntimeMode;
  onRequestLive?: () => void;
}

export function BrowserPanel({
  mode,
  threadId,
  onClosePanel,
  runtimeMode = "live",
  onRequestLive,
}: BrowserPanelProps) {
  const api = readNativeApi();
  const isLiveRuntime = runtimeMode === "live";
  const tabsBarRef = useRef<HTMLDivElement>(null);
  const threadBrowserState = useBrowserStateStore(selectThreadBrowserState(threadId));
  const recentHistory = useBrowserStateStore(selectThreadBrowserHistory(threadId));
  const upsertThreadState = useBrowserStateStore((store) => store.upsertThreadState);
  const addComposerDraftImage = useComposerDraftStore((store) => store.addImage);
  const composerDraftImageCount = useComposerDraftStore(
    (store) => store.draftsByThreadId[threadId]?.images.length ?? 0,
  );
  const composerDraftFileCount = useComposerDraftStore(
    (store) => store.draftsByThreadId[threadId]?.files.length ?? 0,
  );
  const composerDraftAssistantSelectionCount = useComposerDraftStore(
    (store) => store.draftsByThreadId[threadId]?.assistantSelections.length ?? 0,
  );

  const tabs = threadBrowserState?.tabs ?? [];
  const activeTab =
    tabs.find((tab) => tab.id === threadBrowserState?.activeTabId) ?? tabs[0] ?? null;
  const runtime = useBrowserRuntimeSession({
    api,
    threadId,
    isLiveRuntime,
    onRequestLive,
    upsertThreadState,
  });
  const showLocalServersHome =
    isLiveRuntime && runtime.workspaceReady && (!activeTab || isBlankBrowserTabUrl(activeTab));
  const localServersQuery = useQuery(serverLocalServersQueryOptions(showLocalServersHome));
  const address = useBrowserAddressController({
    api,
    threadId,
    isLiveRuntime,
    runtimeReady: runtime.runtimeReady,
    activeTab,
    tabs,
    recentHistory,
    requestLiveRuntime: runtime.requestLiveRuntime,
    ensureLiveRuntime: runtime.ensureLiveRuntime,
    runBrowserAction: runtime.runBrowserAction,
    upsertThreadState,
  });
  const viewport = useBrowserNativeViewport({
    api,
    activeTab,
    isLiveRuntime,
    workspaceReady: runtime.workspaceReady,
    showLocalServersHome,
    threadId,
    runBrowserAction: runtime.runBrowserAction,
    upsertThreadState,
  });
  const actions = useBrowserPanelActions({
    runtime: {
      api,
      threadId,
      isLive: isLiveRuntime,
      ensureLive: runtime.ensureLiveRuntime,
      run: runtime.runBrowserAction,
      upsertState: upsertThreadState,
    },
    address: {
      activeTab,
      inputRef: address.addressInputRef,
    },
    actions: {
      closePanel: onClosePanel,
      setLocalError: runtime.setLocalError,
      composerDraft: {
        imageCount: composerDraftImageCount,
        fileCount: composerDraftFileCount,
        assistantSelectionCount: composerDraftAssistantSelectionCount,
        addImage: addComposerDraftImage,
      },
    },
  });

  const chromeStatus = resolveBrowserChromeStatus({
    localError: runtime.localError,
    threadLastError: threadBrowserState?.lastError,
    activeTabStatus: showLocalServersHome ? "live" : (activeTab?.status ?? "suspended"),
    hasActiveTab: activeTab !== null,
    workspaceReady: runtime.runtimeReady,
  });
  const header = (
    <BrowserPanelChrome
      runtime={{
        isLive: isLiveRuntime,
        loading: activeTab?.isLoading ?? false,
        requestLive: runtime.requestLiveRuntime,
      }}
      address={{
        activeTab,
        inputRef: address.addressInputRef,
        value: address.addressValue,
        suggestions: address.suggestions,
        showSuggestions: address.showSuggestions,
        change: address.changeAddress,
        focus: address.focusAddress,
        blur: address.blurAddress,
        submit: address.submitAddress,
        chooseSuggestion: address.chooseSuggestion,
      }}
      actions={actions}
    />
  );

  if (!api && isLiveRuntime) {
    return (
      <DiffPanelShell mode={mode} header={header}>
        <DiffPanelLoadingState label="Browser is unavailable." />
      </DiffPanelShell>
    );
  }

  return (
    <DiffPanelShell mode={mode} header={header}>
      <BrowserPanelContent
        mode={mode}
        state={{ tabs, activeTab, chromeStatus }}
        runtime={{
          isLive: isLiveRuntime,
          workspaceReady: runtime.workspaceReady,
          showLocalServersHome,
          tabsBarRef,
          viewportRef: viewport.viewportRef,
        }}
        tabActions={{ select: actions.selectTab, close: actions.closeTab }}
        localServers={{
          loading: localServersQuery.isLoading || localServersQuery.isFetching,
          servers: localServersQuery.data?.servers ?? [],
          navigate: address.openLocalServer,
          refresh: () => void localServersQuery.refetch(),
        }}
      />
    </DiffPanelShell>
  );
}

export default BrowserPanel;
