import { Toast, type ToastObject } from "@base-ui/react/toast";
import { useState } from "react";

import { Button, buttonVariants } from "~/components/ui/button";
import { CheckIcon, CopyIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboardCore";
import { ThreadToastVisibleAutoDismiss } from "./ThreadToastVisibleAutoDismiss";
import {
  ARCHIVE_UNDO_TOAST_LINK_CLASS_NAME,
  TOAST_ICONS,
  toastIconClassName,
} from "./toastPresentation";
import type { ToastId } from "./toastManagers";
import type { ThreadToastData } from "./toastTypes";

function ToastActions({
  actionProps,
  copyText,
  secondaryActionProps,
}: {
  actionProps: ToastObject<ThreadToastData>["actionProps"];
  copyText: string | undefined;
  secondaryActionProps: ThreadToastData["secondaryActionProps"];
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  if (!actionProps && !copyText && !secondaryActionProps) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {copyText && (
        <Button
          aria-label={isCopied ? "Copied error message" : "Copy error message"}
          className="self-start rounded-md border-[var(--notification-fg)]/20 bg-[var(--notification-fg)]/10 text-[var(--notification-fg)] hover:bg-[var(--notification-fg)]/20"
          onClick={() => {
            copyToClipboard(copyText, undefined);
          }}
          size="xs"
          title={isCopied ? "Copied error message" : "Copy error message"}
          variant="outline"
        >
          {isCopied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          <span>{isCopied ? "Copied" : "Copy"}</span>
        </Button>
      )}
      {actionProps && (
        <Toast.Action
          {...actionProps}
          className={cn(
            buttonVariants({ size: "xs", variant: "outline" }),
            "self-start rounded-md border-[var(--notification-fg)]/20 bg-[var(--notification-fg)]/10 text-[var(--notification-fg)] hover:bg-[var(--notification-fg)]/20",
            actionProps.className,
          )}
          data-slot="toast-action"
        >
          {actionProps.children}
        </Toast.Action>
      )}
      {secondaryActionProps && (
        <Button
          {...secondaryActionProps}
          className={cn(
            "self-start rounded-md border-[var(--notification-fg)]/20 bg-[var(--notification-fg)]/10 text-[var(--notification-fg)] hover:bg-[var(--notification-fg)]/20",
            secondaryActionProps.className,
          )}
          size={secondaryActionProps.size ?? "xs"}
          variant={secondaryActionProps.variant ?? "outline"}
        />
      )}
    </div>
  );
}

function ToastCloseButton({
  compact = false,
  onDismiss,
  onClose,
}: {
  compact?: boolean;
  onDismiss: () => void;
  onClose?: (() => void) | undefined;
}) {
  return (
    <button
      type="button"
      aria-label="Dismiss toast"
      className={cn(
        // pointer-events-auto keeps the X clickable even when a stacked/collapsed
        // toast still gates its content with pointer-events-none.
        "pointer-events-auto z-10 inline-flex shrink-0 items-center justify-center rounded-full text-[var(--notification-fg)]/65 transition-colors hover:bg-[var(--notification-fg)]/10 hover:text-[var(--notification-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--notification-fg)]/35",
        compact ? "size-5" : "absolute top-2 right-2 size-6",
      )}
      data-slot="toast-close"
      onClick={() => {
        onClose?.();
        onDismiss();
      }}
      title="Dismiss toast"
    >
      <XIcon className={compact ? "size-3" : "size-3.5"} />
    </button>
  );
}

export function ArchiveUndoToastSurface({
  archiveUndo,
  toastId,
  dismissAfterVisibleMs,
  hideCollapsedContent,
  onDismiss,
}: {
  archiveUndo: NonNullable<ThreadToastData["archiveUndo"]>;
  toastId: ToastId;
  dismissAfterVisibleMs: number | undefined;
  hideCollapsedContent: boolean;
  onDismiss: () => void;
}) {
  const [undoPending, setUndoPending] = useState(false);
  // A pending Undo owns the next navigation; keep the Settings path idle until it settles.
  const actionsDisabled = undoPending;

  const handleUndoClick = () => {
    if (actionsDisabled) return;
    setUndoPending(true);
    void (async () => {
      try {
        const restored = await archiveUndo.onUndo();
        if (restored) {
          onDismiss();
          return;
        }
        setUndoPending(false);
      } catch {
        setUndoPending(false);
      }
    })();
  };

  const handleViewArchivedClick = () => {
    if (actionsDisabled) return;
    void archiveUndo.onViewArchived();
    onDismiss();
  };

  return (
    <>
      <ThreadToastVisibleAutoDismiss
        toastId={toastId}
        dismissAfterVisibleMs={dismissAfterVisibleMs}
        paused={undoPending}
      />
      <Toast.Content
        className={cn(
          "pointer-events-auto relative flex items-center gap-2 overflow-hidden px-3.5 py-2 text-[length:var(--app-font-size-ui-sm,11px)] leading-normal transition-opacity duration-250 data-expanded:opacity-100",
          hideCollapsedContent &&
            "not-data-expanded:pointer-events-none not-data-expanded:opacity-0",
        )}
        data-slot="toast-archive-undo"
      >
        <Toast.Title
          className="min-w-0 flex-1 font-normal whitespace-nowrap"
          data-slot="toast-title"
          render={<div />}
        >
          <button
            type="button"
            className={ARCHIVE_UNDO_TOAST_LINK_CLASS_NAME}
            data-base-ui-swipe-ignore
            disabled={actionsDisabled}
            onClick={handleUndoClick}
          >
            Undo
          </button>{" "}
          or view archived chats in{" "}
          <button
            type="button"
            className={ARCHIVE_UNDO_TOAST_LINK_CLASS_NAME}
            data-base-ui-swipe-ignore
            disabled={actionsDisabled}
            onClick={handleViewArchivedClick}
          >
            Settings
          </button>
        </Toast.Title>
        <ToastCloseButton compact onDismiss={onDismiss} />
      </Toast.Content>
    </>
  );
}

export function ToastSurface({
  toast,
  compact,
  hideCollapsedContent,
  onDismiss,
}: {
  toast: ToastObject<ThreadToastData>;
  compact: boolean;
  hideCollapsedContent: boolean;
  onDismiss: () => void;
}) {
  const Icon = toast.type ? TOAST_ICONS[toast.type as keyof typeof TOAST_ICONS] : null;

  return (
    <Toast.Content
      className={cn(
        "pointer-events-auto relative flex overflow-hidden transition-opacity duration-250 data-expanded:opacity-100",
        compact
          ? "items-center gap-2 px-3 py-1.5 pr-1.5 text-[length:var(--app-font-size-ui-sm,11px)] leading-normal"
          : "items-start gap-2 px-3.5 py-3 pr-10 text-sm",
        hideCollapsedContent && "not-data-expanded:pointer-events-none not-data-expanded:opacity-0",
      )}
    >
      {Icon ? (
        <div
          className={cn(
            "shrink-0 [&_svg]:pointer-events-none [&_svg]:shrink-0",
            compact ? "[&>svg]:size-3.5" : "[&>svg]:h-lh [&>svg]:w-4",
          )}
          data-slot="toast-icon"
        >
          <Icon className={toastIconClassName(toast.type)} />
        </div>
      ) : null}

      <div
        className={cn("min-w-0 flex-1", compact ? "flex items-center" : "flex flex-col gap-0.5")}
      >
        <Toast.Title
          className={cn(
            "min-w-0 font-normal",
            compact ? "truncate whitespace-nowrap" : "break-words",
          )}
          data-slot="toast-title"
        />
        {!compact ? (
          <Toast.Description
            className="min-w-0 break-words text-[var(--notification-fg)]/72"
            data-slot="toast-description"
          />
        ) : null}
        {!compact ? (
          <ToastActions
            actionProps={toast.actionProps}
            copyText={toast.data?.copyText}
            secondaryActionProps={toast.data?.secondaryActionProps}
          />
        ) : null}
      </div>

      <ToastCloseButton compact={compact} onClose={toast.data?.onClose} onDismiss={onDismiss} />
    </Toast.Content>
  );
}
