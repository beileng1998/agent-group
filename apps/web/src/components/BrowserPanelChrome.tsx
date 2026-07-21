// FILE: BrowserPanelChrome.tsx
// Purpose: Renders browser navigation chrome, address suggestions, and action menu.
// Layer: Desktop-only browser component view

import type { RefObject } from "react";
import type { BrowserTabState } from "@agent-group/contracts";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CameraIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LinkIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
  type LucideIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";

import type { BrowserAddressSuggestion } from "./BrowserPanel.logic";
import {
  BROWSER_CHROME_CONTROL_CLASS_NAME,
  BROWSER_CHROME_CONTROL_FILLED_CLASS_NAME,
} from "./BrowserPanelContent";
import type { BrowserPanelActions } from "./browser/useBrowserPanelActions";
import { ComposerPickerMenuPopup } from "./chat/ComposerPickerMenuPopup";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from "./ui/menu";

const BROWSER_ACTION_MENU_PANEL_CLASS_NAME = "w-52 min-w-52";
const BROWSER_ACTION_MENU_ITEM_CLASS_NAME =
  "text-[var(--color-text-foreground)] data-highlighted:text-[var(--color-text-foreground)]";
const BROWSER_ACTION_MENU_ICON_CLASS_NAME =
  "inline-flex size-3.5 shrink-0 items-center justify-center text-[var(--color-text-foreground-secondary)] [&>svg]:size-3.5 [&>[data-slot=central-icon]]:size-3.5";

function BrowserActionMenuIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className={BROWSER_ACTION_MENU_ICON_CLASS_NAME}>
      <Icon aria-hidden="true" />
    </span>
  );
}

export interface BrowserPanelChromeRuntime {
  isLive: boolean;
  loading: boolean;
  requestLive: () => void;
}

export interface BrowserPanelChromeAddress {
  activeTab: BrowserTabState | null;
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  suggestions: readonly BrowserAddressSuggestion[];
  showSuggestions: boolean;
  change: (value: string) => void;
  focus: () => void;
  blur: () => void;
  submit: () => void;
  chooseSuggestion: (suggestion: BrowserAddressSuggestion) => void;
}

export interface BrowserPanelChromeProps {
  runtime: BrowserPanelChromeRuntime;
  address: BrowserPanelChromeAddress;
  actions: BrowserPanelActions;
}

export function BrowserPanelChrome({ runtime, address, actions }: BrowserPanelChromeProps) {
  const { activeTab } = address;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {/* Keep the browser chrome interactive inside Electron's draggable titlebar. */}
      <div className="relative flex min-w-0 flex-1 items-center gap-2 [-webkit-app-region:no-drag]">
        <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0"
            disabled={!activeTab?.canGoBack}
            onClick={actions.goBack}
          >
            <ArrowLeftIcon className="size-3.5" />
            <span className="sr-only">Go back</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0"
            disabled={!activeTab?.canGoForward}
            onClick={actions.goForward}
          >
            <ArrowRightIcon className="size-3.5" />
            <span className="sr-only">Go forward</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0"
            disabled={!activeTab}
            onClick={actions.reload}
          >
            {runtime.loading ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3.5" />
            )}
            <span className="sr-only">Reload</span>
          </Button>
        </div>
        <form
          className="min-w-0 flex-1 [-webkit-app-region:no-drag]"
          onSubmit={(event) => {
            event.preventDefault();
            address.submit();
          }}
        >
          <Input
            ref={address.inputRef}
            value={address.value}
            onChange={(event) => {
              address.change(event.target.value);
            }}
            onFocus={() => {
              address.focus();
            }}
            onBlur={() => {
              address.blur();
            }}
            placeholder="Search or enter a URL"
            className={cn(
              "min-w-0 [-webkit-app-region:no-drag]",
              BROWSER_CHROME_CONTROL_CLASS_NAME,
              BROWSER_CHROME_CONTROL_FILLED_CLASS_NAME,
            )}
          />
        </form>
        {address.showSuggestions ? (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-lg border border-border bg-popover shadow-lg [-webkit-app-region:no-drag]">
            <div className="max-h-64 overflow-auto p-1">
              {address.suggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    address.chooseSuggestion(suggestion);
                  }}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-background/80">
                    {suggestion.kind === "navigate" ? (
                      <ExternalLinkIcon className="size-3 text-muted-foreground" />
                    ) : suggestion.faviconUrl ? (
                      <img alt="" src={suggestion.faviconUrl} className="size-3 rounded-[2px]" />
                    ) : (
                      <GlobeIcon className="size-3 text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{suggestion.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {suggestion.detail}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        <Button
          ref={actions.copyScreenshotButtonRef}
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          disabled={!activeTab}
          aria-label="Copy screenshot"
          title="Copy screenshot"
          onClick={actions.copyScreenshotToClipboard}
        >
          <CameraIcon className="size-3.5" />
          <span className="sr-only">Copy screenshot</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          disabled={!activeTab}
          aria-label="Copy link"
          title="Copy link"
          onClick={actions.copyActiveTabLink}
        >
          <LinkIcon className="size-3.5" />
          <span className="sr-only">Copy link</span>
        </Button>
        <Menu modal={false}>
          <MenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7"
                aria-label="Browser actions"
              />
            }
          >
            <EllipsisIcon className="size-3.5" />
          </MenuTrigger>
          <ComposerPickerMenuPopup
            align="end"
            side="bottom"
            className={BROWSER_ACTION_MENU_PANEL_CLASS_NAME}
          >
            <MenuItem className={BROWSER_ACTION_MENU_ITEM_CLASS_NAME} onClick={actions.createTab}>
              <BrowserActionMenuIcon icon={PlusIcon} />
              <span>New tab</span>
            </MenuItem>
            <MenuItem
              className={BROWSER_ACTION_MENU_ITEM_CLASS_NAME}
              disabled={!activeTab}
              onClick={actions.captureScreenshot}
            >
              <BrowserActionMenuIcon icon={CameraIcon} />
              <span>Capture screenshot</span>
            </MenuItem>
            <MenuItem
              className={BROWSER_ACTION_MENU_ITEM_CLASS_NAME}
              disabled={!activeTab}
              onClick={actions.openExternal}
            >
              <BrowserActionMenuIcon icon={ExternalLinkIcon} />
              <span>Open externally</span>
            </MenuItem>
            <MenuSeparator />
            <MenuItem className={BROWSER_ACTION_MENU_ITEM_CLASS_NAME} onClick={actions.closePanel}>
              <BrowserActionMenuIcon icon={XIcon} />
              <span>Close browser panel</span>
            </MenuItem>
          </ComposerPickerMenuPopup>
        </Menu>
      </div>
    </div>
  );
}
