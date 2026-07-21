import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import type { BranchSelectorController } from "./useBranchSelectorController";

interface BranchSelectorDialogsProps {
  controller: BranchSelectorController;
}

export function BranchSelectorDialogs({ controller }: BranchSelectorDialogsProps) {
  const { readModel } = controller;
  return (
    <>
      <Dialog
        open={controller.isCreateBranchDialogOpen}
        onOpenChange={(open) => {
          controller.setIsCreateBranchDialogOpen(open);
          if (!open) controller.setCreateBranchName("");
        }}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Branch</DialogTitle>
            <DialogDescription>
              {`Create and switch to a new branch from ${controller.resolvedActiveBranch ?? readModel.currentGitBranch ?? "the current HEAD"}.`}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const nextName = controller.createBranchName.trim();
                if (!nextName || readModel.branchByName.has(nextName)) return;
                controller.setIsCreateBranchDialogOpen(false);
                controller.createBranch(nextName);
              }}
            >
              <div className="space-y-1.5">
                <label className="block font-medium text-sm" htmlFor="branch-create-name">
                  Branch name
                </label>
                <Input
                  autoFocus
                  id="branch-create-name"
                  placeholder="feature/my-change"
                  value={controller.createBranchName}
                  onChange={(event) => controller.setCreateBranchName(event.target.value)}
                />
              </div>
              {readModel.branchByName.has(controller.createBranchName.trim()) ? (
                <p className="text-destructive text-sm">A branch with this name already exists.</p>
              ) : null}
              <DialogFooter variant="bare">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => {
                    controller.setIsCreateBranchDialogOpen(false);
                    controller.setCreateBranchName("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    controller.createBranchName.trim().length === 0 ||
                    readModel.branchByName.has(controller.createBranchName.trim())
                  }
                >
                  Create and switch
                </Button>
              </DialogFooter>
            </form>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
      <Dialog
        open={controller.stashDiscardDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            controller.setStashDiscardDialog(null);
            controller.setIsDroppingStash(false);
          }
        }}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Discard saved stash?</DialogTitle>
            <DialogDescription>
              This will permanently drop the stash entry that preserved your uncommitted changes.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            {controller.stashDiscardDialog?.loading ? (
              <p className="text-muted-foreground text-sm">Loading stash details...</p>
            ) : controller.stashDiscardDialog?.error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm">
                {controller.stashDiscardDialog.error}
              </p>
            ) : controller.stashDiscardDialog?.info ? (
              <>
                <div className="grid gap-2 rounded-lg border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)] p-3 text-sm">
                  <div className="flex min-w-0 gap-2">
                    <span className="w-20 shrink-0 text-muted-foreground">Branch</span>
                    <span className="min-w-0 truncate font-medium">
                      {controller.stashDiscardDialog.info.branch ??
                        readModel.currentGitBranch ??
                        "Detached HEAD"}
                    </span>
                  </div>
                  <div className="flex min-w-0 gap-2">
                    <span className="w-20 shrink-0 text-muted-foreground">Worktree</span>
                    <span className="min-w-0 truncate font-mono text-xs">
                      {controller.stashDiscardDialog.info.cwd}
                    </span>
                  </div>
                  <div className="flex min-w-0 gap-2">
                    <span className="w-20 shrink-0 text-muted-foreground">Stash</span>
                    <span className="min-w-0 truncate font-mono text-xs">
                      {controller.stashDiscardDialog.info.stashRef}
                    </span>
                  </div>
                  <div className="flex min-w-0 gap-2">
                    <span className="w-20 shrink-0 text-muted-foreground">Name</span>
                    <span className="min-w-0 truncate">
                      {controller.stashDiscardDialog.info.message}
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="font-medium text-sm">
                    Changed files ({controller.stashDiscardDialog.info.files.length})
                  </p>
                  {controller.stashDiscardDialog.info.files.length > 0 ? (
                    <ul className="max-h-48 overflow-auto rounded-lg border border-[color:var(--color-border-light)] bg-[var(--color-background-control-opaque)] py-1">
                      {controller.stashDiscardDialog.info.files.map((file) => (
                        <li
                          className="truncate px-3 py-1 font-mono text-muted-foreground text-xs"
                          key={file}
                          title={file}
                        >
                          {file}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-lg border border-[color:var(--color-border-light)] px-3 py-2 text-muted-foreground text-sm">
                      Git did not report changed file names for this stash.
                    </p>
                  )}
                </div>
              </>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                controller.setStashDiscardDialog(null);
                controller.setIsDroppingStash(false);
              }}
            >
              Keep stash
            </Button>
            <Button
              variant="destructive"
              type="button"
              disabled={!controller.stashDiscardDialog?.info || controller.isDroppingStash}
              onClick={controller.discardStashFromDialog}
            >
              {controller.isDroppingStash ? "Discarding..." : "Discard stash"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
