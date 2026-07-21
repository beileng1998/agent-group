import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
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
import { ScrollArea } from "../ui/scroll-area";
import { Textarea } from "../ui/textarea";
import { COMMIT_DIALOG_DESCRIPTION, COMMIT_DIALOG_TITLE } from "./GitActionPresentation";

export interface GitCommitDialogFile {
  path: string;
  insertions: number;
  deletions: number;
}

export interface GitCommitDialogModel {
  open: boolean;
  branchName: string | null;
  isDefaultBranch: boolean;
  files: readonly GitCommitDialogFile[];
  selectedFiles: readonly GitCommitDialogFile[];
  excludedFiles: ReadonlySet<string>;
  allSelected: boolean;
  noneSelected: boolean;
  isEditingFiles: boolean;
  commitMessage: string;
  onOpenChange: (open: boolean) => void;
  onToggleAllFiles: () => void;
  onToggleFile: (filePath: string) => void;
  onToggleEditingFiles: () => void;
  onCommitMessageChange: (value: string) => void;
  onOpenFile: (filePath: string) => void;
  onCommitOnNewBranch: () => void;
  onCommit: () => void;
}

export interface GitDefaultBranchDialogModel {
  open: boolean;
  title: string | null;
  description: string | null;
  continueLabel: string | null;
  requiresFeatureBranch: boolean;
  onOpenChange: (open: boolean) => void;
  onAbort: () => void;
  onContinue: () => void;
  onCheckoutFeatureBranch: () => void;
}

export interface GitCreateBranchDialogModel {
  open: boolean;
  branchName: string;
  branchNameConflicts: boolean;
  onOpenChange: (open: boolean) => void;
  onBranchNameChange: (value: string) => void;
  onSubmit: (branchName: string) => void;
}

export interface GitActionDialogsProps {
  commit: GitCommitDialogModel;
  defaultBranch: GitDefaultBranchDialogModel;
  createBranch: GitCreateBranchDialogModel;
}

function GitCommitDialog({ model }: { model: GitCommitDialogModel }) {
  return (
    <Dialog open={model.open} onOpenChange={model.onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{COMMIT_DIALOG_TITLE}</DialogTitle>
          <DialogDescription>{COMMIT_DIALOG_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="space-y-3 rounded-lg border border-[color:var(--color-border)] bg-[var(--color-background-elevated-secondary)] p-3 text-xs">
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
              <span className="text-muted-foreground">Branch</span>
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{model.branchName ?? "(detached HEAD)"}</span>
                {model.isDefaultBranch && (
                  <span className="text-right text-warning text-xs">Warning: default branch</span>
                )}
              </span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {model.isEditingFiles && model.files.length > 0 && (
                    <Checkbox
                      checked={model.allSelected}
                      indeterminate={!model.allSelected && !model.noneSelected}
                      onCheckedChange={model.onToggleAllFiles}
                    />
                  )}
                  <span className="text-muted-foreground">Files</span>
                  {!model.allSelected && !model.isEditingFiles && (
                    <span className="text-muted-foreground">
                      ({model.selectedFiles.length} of {model.files.length})
                    </span>
                  )}
                </div>
                {model.files.length > 0 && (
                  <Button variant="ghost" size="xs" onClick={model.onToggleEditingFiles}>
                    {model.isEditingFiles ? "Done" : "Edit"}
                  </Button>
                )}
              </div>
              {model.files.length === 0 ? (
                <p className="font-medium">none</p>
              ) : (
                <div className="space-y-2">
                  <ScrollArea className="h-44 rounded-md border border-[color:var(--color-border)] bg-[var(--color-background-elevated-primary-opaque)]">
                    <div className="space-y-1 p-1">
                      {model.files.map((file) => {
                        const isExcluded = model.excludedFiles.has(file.path);
                        return (
                          <div
                            key={file.path}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1 font-mono text-xs transition-colors hover:bg-[var(--color-background-button-secondary-hover)]"
                          >
                            {model.isEditingFiles && (
                              <Checkbox
                                checked={!isExcluded}
                                onCheckedChange={() => model.onToggleFile(file.path)}
                              />
                            )}
                            <button
                              type="button"
                              className="group flex flex-1 items-center justify-between gap-3 text-left truncate"
                              onClick={() => model.onOpenFile(file.path)}
                            >
                              <span
                                className={`truncate underline-offset-2 group-hover:underline group-focus-visible:underline${isExcluded ? " text-muted-foreground" : ""}`}
                              >
                                {file.path}
                              </span>
                              <span className="shrink-0">
                                {isExcluded ? (
                                  <span className="text-muted-foreground">Excluded</span>
                                ) : (
                                  <>
                                    <span className="text-success">+{file.insertions}</span>
                                    <span className="text-muted-foreground"> / </span>
                                    <span className="text-destructive">-{file.deletions}</span>
                                  </>
                                )}
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                  <div className="flex justify-end font-mono">
                    <span className="text-success">
                      +{model.selectedFiles.reduce((sum, file) => sum + file.insertions, 0)}
                    </span>
                    <span className="text-muted-foreground"> / </span>
                    <span className="text-destructive">
                      -{model.selectedFiles.reduce((sum, file) => sum + file.deletions, 0)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium">Commit message (optional)</p>
            <Textarea
              value={model.commitMessage}
              onChange={(event) => model.onCommitMessageChange(event.target.value)}
              placeholder="Leave empty to auto-generate"
              size="sm"
            />
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => model.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={model.noneSelected}
            onClick={model.onCommitOnNewBranch}
          >
            Commit on new branch
          </Button>
          <Button size="sm" disabled={model.noneSelected} onClick={model.onCommit}>
            Commit
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function GitDefaultBranchDialog({ model }: { model: GitDefaultBranchDialogModel }) {
  return (
    <Dialog open={model.open} onOpenChange={model.onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{model.title ?? "Run action on default branch?"}</DialogTitle>
          <DialogDescription>{model.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={model.onAbort}>
            Abort
          </Button>
          <Button variant="outline" size="sm" onClick={model.onContinue}>
            {model.requiresFeatureBranch
              ? "Create feature branch & continue"
              : (model.continueLabel ?? "Continue")}
          </Button>
          {!model.requiresFeatureBranch ? (
            <Button size="sm" onClick={model.onCheckoutFeatureBranch}>
              Checkout feature branch & continue
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function GitCreateBranchDialog({ model }: { model: GitCreateBranchDialogModel }) {
  return (
    <Dialog open={model.open} onOpenChange={model.onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Branch</DialogTitle>
          <DialogDescription>
            Create and switch to a branch from the current HEAD. Future commits, pushes, and PRs
            will use it.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmedName = model.branchName.trim();
              if (!trimmedName || model.branchNameConflicts) return;
              model.onSubmit(trimmedName);
            }}
          >
            <div className="space-y-1.5">
              <label className="block font-medium text-sm" htmlFor="create-branch-name">
                Branch name
              </label>
              <Input
                autoFocus
                id="create-branch-name"
                placeholder="feature/my-change"
                value={model.branchName}
                onChange={(event) => model.onBranchNameChange(event.target.value)}
              />
            </div>
            {model.branchNameConflicts ? (
              <p className="text-destructive text-sm">A branch with this name already exists.</p>
            ) : null}
            <DialogFooter variant="bare">
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => model.onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={model.branchName.trim().length === 0 || model.branchNameConflicts}
              >
                Create Branch
              </Button>
            </DialogFooter>
          </form>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

export function GitActionDialogs({ commit, defaultBranch, createBranch }: GitActionDialogsProps) {
  return (
    <>
      <GitCommitDialog model={commit} />
      <GitDefaultBranchDialog model={defaultBranch} />
      <GitCreateBranchDialog model={createBranch} />
    </>
  );
}
