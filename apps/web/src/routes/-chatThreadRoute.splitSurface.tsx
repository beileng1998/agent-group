import type { ThreadId } from "@agent-group/contracts";
import type { ReactNode } from "react";

import { ProviderIcon } from "../components/ProviderIcon";
import { ChatMountSkeleton } from "../components/chat/ChatRouteDeferredSurface";
import {
  CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
} from "../components/chat/composerPickerStyles";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { canSubdividePane } from "../splitView.logic";
import type { LeafPane, SplitViewId } from "../splitViewStore";
import { cn } from "~/lib/utils";
import { resolveThreadPickerTitle } from "./-chatThreadRoute.logic";
import {
  type SplitChatRouteController,
  useSplitChatRouteController,
} from "./-chatThreadRoute.splitController";
import { PaneRenderer } from "./-chatThreadRoute.splitLayout";
import { SplitPaneSurface } from "./-chatThreadRoute.splitPaneSurface";

const noop = () => {};

function SplitChatSurfaceView(props: { controller: SplitChatRouteController }) {
  const controller = props.controller;
  const splitView = controller.activeSplitView;
  if (!splitView) {
    return <ChatMountSkeleton />;
  }

  const renderLeaf = ({ leaf }: { leaf: LeafPane }): ReactNode => {
    const isFocused = leaf.id === splitView.focusedPaneId;
    const excluded = new Set<ThreadId>(controller.splitThreadIds);
    return (
      <SplitPaneSurface
        key={leaf.id}
        splitView={splitView}
        paneId={leaf.id}
        threadId={leaf.threadId}
        panelState={leaf.panel}
        isFocused={isFocused}
        deferChatMount={false}
        canDropInDirection={(direction) => canSubdividePane(splitView.root, leaf.id, direction)}
        excludedThreadIds={excluded}
        threads={controller.selectableThreads}
        projects={controller.projects}
        onFocus={() => controller.focusPane(leaf.id)}
        onToggleDiff={() => controller.togglePanePanel(leaf.id, "diff")}
        onToggleBrowser={() => controller.togglePanePanel(leaf.id, "browser")}
        onOpenBrowserUrl={() => controller.openPaneBrowser(leaf.id)}
        onOpenTurnDiff={(turnId, filePath) =>
          controller.openPaneTurnDiff(leaf.id, turnId, filePath)
        }
        onClosePanel={() => controller.closePanePanel(leaf.id)}
        onUpdatePanelState={(patch) => controller.updatePanePanelState(leaf.id, patch)}
        onMaximize={controller.maximizeFocusedPane}
        onCloseThreadPane={() => controller.closePaneThread(leaf.id)}
        onChooseThread={() => controller.openThreadPicker(leaf.id)}
        onSelectThread={(threadId) => controller.chooseThreadForPane(threadId, leaf.id)}
        onChatMounted={noop}
        onDropThread={(payload) => controller.dropThread(leaf.id, payload)}
      />
    );
  };

  return (
    <>
      <div
        className={cn(CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME, CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}
      >
        <PaneRenderer
          pane={splitView.root}
          splitView={splitView}
          renderLeaf={renderLeaf}
          onSetRatio={controller.setRatio}
        />
      </div>
      <Dialog
        open={controller.threadPickerPaneId !== null}
        onOpenChange={(open) => {
          if (!open) controller.closeThreadPicker();
        }}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader className="items-center text-center">
            <DialogTitle>Choose Chat</DialogTitle>
            <DialogDescription className="max-w-sm text-center">
              Pick which chat should appear in the focused split pane.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <div className="max-h-[56vh] space-y-1 overflow-y-auto">
              {controller.selectableThreads.map((thread) => {
                const projectName =
                  controller.projects.find((project) => project.id === thread.projectId)?.name ??
                  "Project";
                const isSelected = controller.pickerThreadId === thread.id;
                return (
                  <button
                    key={thread.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                      isSelected
                        ? "border-[color:var(--color-border)] bg-[var(--sidebar-accent)]"
                        : "border-[color:var(--color-border-light)] hover:bg-[var(--sidebar-accent)]",
                    )}
                    onClick={() => controller.chooseThreadForPane(thread.id)}
                  >
                    <ProviderIcon
                      provider={thread.modelSelection.provider}
                      className="size-4 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {resolveThreadPickerTitle(thread.title)}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{projectName}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <DialogFooter variant="bare">
              <Button type="button" variant="outline" onClick={controller.closeThreadPicker}>
                Cancel
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}

export function SplitChatSurface(props: { splitViewId: SplitViewId; routeThreadId: ThreadId }) {
  const controller = useSplitChatRouteController(props);
  return <SplitChatSurfaceView controller={controller} />;
}
