// FILE: SidebarProjectRunDialog.tsx
// Purpose: Render the sidebar project dev-server launch dialog.

import type { SidebarProjectRunDialogModel } from "../../hooks/useSidebarProjectRunOwner";
import { PlayIcon } from "~/lib/icons";
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

interface SidebarProjectRunDialogProps {
  readonly model: SidebarProjectRunDialogModel;
  readonly onClose: () => void;
  readonly onCommandChange: (command: string) => void;
  readonly onConfirm: () => void;
}

export function SidebarProjectRunDialog({
  model,
  onClose,
  onCommandChange,
  onConfirm,
}: SidebarProjectRunDialogProps) {
  return (
    <Dialog open={model.open} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup surface="solid" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <PlayIcon className="size-4 text-emerald-500" />
            Start dev
          </DialogTitle>
          <DialogDescription>{model.projectName}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-2">
          <label
            htmlFor="project-run-command-input"
            className="block text-[length:var(--app-font-size-ui-xs,10px)] font-medium text-[var(--color-text-foreground-secondary)]"
          >
            Command
          </label>
          <Input
            id="project-run-command-input"
            autoFocus
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="e.g. npm run dev"
            value={model.commandDraft}
            aria-invalid={model.commandIsValid ? undefined : true}
            onChange={(event) => onCommandChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onConfirm();
              }
            }}
          />
          {model.commandIsValid ? null : (
            <p className="text-[length:var(--app-font-size-ui-sm,11px)] text-destructive">
              Enter a command to run.
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!model.commandIsValid || model.hasExistingRun}>
            <PlayIcon className="size-4" />
            Run
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
