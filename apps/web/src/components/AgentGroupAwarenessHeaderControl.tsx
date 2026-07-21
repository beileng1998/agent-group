import type { ProjectId, ThreadId } from "@agent-group/contracts";
import { useState } from "react";

import { useAgentGroupAwareness } from "~/hooks/useAgentGroupAwareness";
import {
  dismissAgentGroupAwarenessNotice,
  shouldShowAgentGroupAwarenessNotice,
} from "~/lib/agentGroupAwarenessNotice";
import { FocusIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { IconButton } from "./ui/icon-button";

export function AgentGroupAwarenessHeaderControl(props: {
  groupId: ProjectId;
  sessionId: ThreadId;
  sessionTitle: string;
}) {
  const awareness = useAgentGroupAwareness(props.groupId);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const enabled =
    awareness.awarenessBySessionId.get(props.sessionId) ?? awareness.awarenessDefaultEnabled;
  const saving = awareness.savingSessionIds.has(props.sessionId);
  const actionLabel = enabled ? "Turn off Awareness" : "Turn on Awareness";

  const toggle = () => void awareness.toggleAwareness(props.sessionId);
  const requestToggle = () => {
    if (shouldShowAgentGroupAwarenessNotice()) {
      setNoticeOpen(true);
      return;
    }
    toggle();
  };

  return (
    <>
      <IconButton
        label={`${props.sessionTitle}: ${actionLabel}`}
        tooltip={enabled ? "Awareness on" : "Awareness off"}
        tooltipSide="bottom"
        disabled={awareness.loading || saving}
        aria-pressed={enabled}
        className={cn(
          "size-5 shrink-0 rounded-md [-webkit-app-region:no-drag]",
          enabled
            ? "bg-[var(--color-background-button-secondary)] text-[var(--color-text-accent)] hover:text-[var(--color-text-accent)]"
            : "text-muted-foreground/55 hover:text-foreground",
        )}
        onClick={requestToggle}
      >
        <FocusIcon className="size-4" />
      </IconButton>

      <AlertDialog
        open={noticeOpen}
        onOpenChange={(open) => {
          setNoticeOpen(open);
          if (!open) setDontShowAgain(false);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Session Awareness</AlertDialogTitle>
            <AlertDialogDescription>
              When other Session Context files change, Awareness asks this Agent to review and
              incorporate relevant updates before working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="mx-4 flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs">
            <Checkbox
              checked={dontShowAgain}
              onCheckedChange={(checked) => setDontShowAgain(Boolean(checked))}
            />
            <span>Don't show this explanation again</span>
          </label>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              Cancel
            </AlertDialogClose>
            <Button
              size="sm"
              onClick={() => {
                if (dontShowAgain) dismissAgentGroupAwarenessNotice();
                setNoticeOpen(false);
                toggle();
              }}
            >
              {actionLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
