import { Button } from "~/components/ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import type { PullRequestDetailController } from "./usePullRequestDetailController";

export function PullRequestConfirmDialog({
  controller,
}: {
  controller: PullRequestDetailController;
}) {
  const { input, confirmAction, setConfirmAction, selectedMergeMethod, actionPending, runAction } =
    controller;

  return (
    <AlertDialog
      open={confirmAction !== null}
      onOpenChange={(open) => !open && setConfirmAction(null)}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirmAction === "merge" ? "Merge pull request?" : "Close pull request?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmAction === "merge"
              ? `This will merge #${input.number} using ${selectedMergeMethod}.`
              : `This will close #${input.number} without merging it.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" size="sm" />}>
            Cancel
          </AlertDialogClose>
          <Button
            size="sm"
            variant={confirmAction === "close" ? "destructive" : "default"}
            disabled={actionPending}
            onClick={() => {
              const action = confirmAction;
              setConfirmAction(null);
              if (action === "merge") void runAction("merge", selectedMergeMethod);
              if (action === "close") void runAction("close");
            }}
          >
            {confirmAction === "merge" ? "Merge" : "Close"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
