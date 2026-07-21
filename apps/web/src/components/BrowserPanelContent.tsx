// FILE: BrowserPanelContent.tsx
// Purpose: Renders browser tabs, runtime placeholders, viewport host, and local-server home.
// Layer: Desktop-only React component

import type { RefObject } from "react";
import type { BrowserTabState, ServerLocalServerProcess } from "@agent-group/contracts";
import { localServerPrimaryLabel } from "@agent-group/shared/localServers";
import { isBlankBrowserTabUrl } from "@agent-group/shared/browserSession";

import { GlobeIcon, RefreshCwIcon, XIcon } from "~/lib/icons";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";

import type { BrowserChromeStatus } from "./BrowserPanel.logic";
import { DiffPanelLoadingState, type DiffPanelMode } from "./DiffPanelShell";
import { LocalServerIdentity } from "./LocalServerIdentity";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

// The address field and tab pills share one chrome-control surface so the whole row reads
// as a single cohesive control: matching height, radius, border width, and type scale.
export const BROWSER_CHROME_CONTROL_CLASS_NAME = "h-8 rounded-lg border text-xs";
// The address field's filled look, reused by the active tab so the selected tab visually
// matches the search input (same border tone + faint fill).
export const BROWSER_CHROME_CONTROL_FILLED_CLASS_NAME = "border-border bg-background/70";

interface BrowserPanelContentState {
  tabs: readonly BrowserTabState[];
  activeTab: BrowserTabState | null;
  chromeStatus: BrowserChromeStatus | null;
}

interface BrowserPanelContentRuntime {
  isLive: boolean;
  workspaceReady: boolean;
  showLocalServersHome: boolean;
  tabsBarRef: RefObject<HTMLDivElement | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
}

interface BrowserPanelTabActions {
  select: (tabId: string) => void;
  close: (tabId: string) => void;
}

interface BrowserPanelLocalServers {
  loading: boolean;
  servers: readonly ServerLocalServerProcess[];
  navigate: (url: string, tabId: string | null) => void;
  refresh: () => void;
}

export interface BrowserPanelContentProps {
  mode: DiffPanelMode;
  state: BrowserPanelContentState;
  runtime: BrowserPanelContentRuntime;
  tabActions: BrowserPanelTabActions;
  localServers: BrowserPanelLocalServers;
}

function closeButtonClassName(isActive: boolean) {
  return cn(
    "ml-1 size-5 shrink-0 rounded-sm p-0 text-muted-foreground/70 hover:bg-background/80 hover:text-foreground",
    isActive ? "hover:bg-background" : "hover:bg-card",
  );
}

// Keeps a restored browser pane visually occupied while the live webview hydrates.
function BrowserRuntimePreview(props: { title: string; detail: string }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-background/35 p-6"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-sm rounded-xl border border-border/60 bg-card/70 p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3 rounded-full" />
            <Skeleton className="h-2.5 w-full rounded-full" />
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-20 w-full rounded-lg" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-8 rounded-md" />
            <Skeleton className="h-8 rounded-md" />
            <Skeleton className="h-8 rounded-md" />
          </div>
        </div>
        <div className="mt-4 min-w-0 text-center">
          <p className="text-xs font-medium text-foreground">Restoring browser</p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground" title={props.detail}>
            {props.title}
          </p>
        </div>
      </div>
    </div>
  );
}

function browserLocalServerUrl(server: ServerLocalServerProcess): string | null {
  const addressWithUrl = server.addresses.find((address) => address.url);
  if (addressWithUrl?.url) {
    return addressWithUrl.url;
  }

  const port = server.ports[0];
  if (!port) {
    return null;
  }
  return `http://localhost:${port}/`;
}

// Paints a tiny browser-preview tile without fetching screenshots or adding network work.
// The page name and address are rendered into the tile so it reads as a real preview.
function BrowserLocalServerThumbnail({ server }: { server: ServerLocalServerProcess }) {
  const label = localServerPrimaryLabel(server);
  const port = server.ports[0];

  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-[4.5rem] shrink-0 flex-col gap-1 overflow-hidden rounded-md border border-white/12 bg-[#f7f7f2] p-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.28)]"
    >
      <span className="flex gap-[3px]">
        <span className="size-[3px] rounded-full bg-[#ff6b65]" />
        <span className="size-[3px] rounded-full bg-[#f4c047]" />
        <span className="size-[3px] rounded-full bg-[#45cf77]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <span className="truncate text-[7px] font-bold leading-none text-[#2a2a2a]">{label}</span>
        {port ? (
          <span className="truncate text-[6px] font-medium leading-none text-[#9a9a9a]">
            localhost:{port}
          </span>
        ) : null}
      </span>
    </span>
  );
}

// Replaces about:blank with a local-server launcher so the browser never opens to white.
function BrowserLocalServersHome({
  activeTabId,
  loading,
  onNavigate,
  onRefresh,
  servers,
}: {
  activeTabId: string | null;
  loading: boolean;
  onNavigate: (url: string, tabId: string | null) => void;
  onRefresh: () => void;
  servers: readonly ServerLocalServerProcess[];
}) {
  const hasServers = servers.length > 0;

  return (
    <div className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-[#0d0d0d] text-white">
      <div className="mx-auto flex h-full w-full max-w-[52rem] flex-col px-8 py-9">
        <div className="flex shrink-0 items-center justify-between">
          <p className="text-[15px] font-medium text-white/35">Local</p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-8 text-white/35 hover:bg-white/[0.06] hover:text-white/70"
            disabled={loading}
            onClick={onRefresh}
            aria-label="Refresh local servers"
            title="Refresh local servers"
          >
            <RefreshCwIcon className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>

        {!hasServers ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
            {loading ? (
              <>
                <RefreshCwIcon className="mb-4 size-12 animate-spin text-white/20" />
                <p className="text-base font-semibold text-white">Scanning local servers</p>
                <p className="mt-2 text-sm text-white/35">Checking localhost ports</p>
              </>
            ) : (
              <>
                <GlobeIcon className="mb-4 size-16 stroke-[1.5] text-white/30" />
                <p className="text-base font-semibold text-white">No local servers</p>
                <p className="mt-2 text-sm text-white/35">Try another browser URL</p>
              </>
            )}
          </div>
        ) : (
          <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-6">
            {servers.map((server) => {
              const url = browserLocalServerUrl(server);

              return (
                <button
                  key={server.id}
                  type="button"
                  disabled={!url}
                  onClick={() => {
                    if (url) {
                      onNavigate(url, activeTabId);
                    }
                  }}
                  className="group grid w-full shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 rounded-xl border border-white/[0.07] px-3 py-2.5 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <BrowserLocalServerThumbnail server={server} />
                  <LocalServerIdentity server={server} tone="browser" />
                  <span
                    className="mr-1 size-2 rounded-full bg-[#36d07b] shadow-[0_0_0_2.5px_rgba(54,208,123,0.16)]"
                    aria-hidden
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function BrowserPanelContent({
  mode,
  state,
  runtime,
  tabActions,
  localServers,
}: BrowserPanelContentProps) {
  const { activeTab, chromeStatus, tabs } = state;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={runtime.tabsBarRef}
        className={cn(
          "flex items-center gap-2 border-b border-border px-2 py-1.5",
          // Extend the frameless window drag region across the tab strip's empty space so
          // the panel is easy to grab; interactive children stay no-drag via global CSS.
          isElectron && mode !== "sheet" && "drag-region",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;
            const tabIsBlank = isBlankBrowserTabUrl(tab);
            return (
              <div
                key={tab.id}
                className={cn(
                  "group flex min-w-0 max-w-[14rem] items-center px-2.5 text-left transition-colors",
                  BROWSER_CHROME_CONTROL_CLASS_NAME,
                  isActive
                    ? cn(BROWSER_CHROME_CONTROL_FILLED_CLASS_NAME, "text-foreground")
                    : "border-transparent text-muted-foreground hover:border-border/60 hover:bg-background/40 hover:text-foreground",
                  tab.status === "suspended" && !tabIsBlank ? "opacity-75" : "",
                )}
              >
                <span className="mr-2 flex size-4 shrink-0 items-center justify-center rounded-sm">
                  {tab.faviconUrl ? (
                    <img alt="" src={tab.faviconUrl} className="size-3 rounded-[2px]" />
                  ) : (
                    <GlobeIcon className="size-3 text-muted-foreground" />
                  )}
                </span>
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => tabActions.select(tab.id)}
                >
                  {tab.title || "Untitled"}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={closeButtonClassName(isActive)}
                  onClick={(event) => {
                    event.stopPropagation();
                    tabActions.close(tab.id);
                  }}
                >
                  <XIcon className="size-3" />
                  <span className="sr-only">Close tab</span>
                </Button>
              </div>
            );
          })}
        </div>
        {chromeStatus ? (
          <div
            className={cn(
              "max-w-[13rem] shrink-0 truncate rounded-full border px-2.5 py-1 text-[11px] leading-none sm:max-w-[16rem]",
              chromeStatus.tone === "error"
                ? "border-destructive/25 bg-destructive/8 text-destructive"
                : "border-border/60 bg-background/80 text-muted-foreground",
            )}
            title={chromeStatus.label}
          >
            {chromeStatus.label}
          </div>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1 bg-transparent">
        {!runtime.isLive ? (
          <BrowserRuntimePreview
            title={activeTab?.title || "Browser is sleeping"}
            detail={activeTab?.lastCommittedUrl ?? activeTab?.url ?? "Restoring cached browser"}
          />
        ) : !runtime.workspaceReady ? (
          <div className="absolute inset-0 z-10">
            <DiffPanelLoadingState label="Starting browser..." />
          </div>
        ) : null}
        {runtime.isLive ? (
          <div ref={runtime.viewportRef} className="absolute inset-0 bg-[#0d0d0d]" />
        ) : null}
        {runtime.showLocalServersHome ? (
          <BrowserLocalServersHome
            activeTabId={activeTab?.id ?? null}
            loading={localServers.loading}
            onNavigate={localServers.navigate}
            onRefresh={localServers.refresh}
            servers={localServers.servers}
          />
        ) : null}
      </div>
    </div>
  );
}
