// FILE: ImportThemeDialog.tsx
// Purpose: Imports a validated theme share string for one theme variant.
// Layer: Web settings UI

import { useState } from "react";
import type { ThemeVariant } from "../../hooks/useTheme";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";

export function ImportThemeDialog({
  variant,
  onImport,
}: {
  variant: ThemeVariant;
  onImport: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    try {
      onImport(value);
      toastManager.add({
        type: "success",
        title: "Theme imported",
        description: `Updated the ${variant} theme pack.`,
      });
      setValue("");
      setError(null);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to import that theme string.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs text-[var(--color-text-foreground-secondary)] transition-colors hover:bg-[var(--color-background-elevated-secondary)] hover:text-[var(--color-text-foreground)]"
          >
            Import
          </button>
        }
      />
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import {variant} theme</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Paste a{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-chat-code">codex-theme-v1:</code>{" "}
            share string. The embedded variant must match {variant}, and the selected code theme
            must exist for that variant.
          </p>
        </DialogHeader>
        <DialogPanel>
          <Textarea
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            placeholder='codex-theme-v1:{"codeThemeId":"linear",...}'
            spellCheck={false}
            rows={5}
            className="font-chat-code text-[11px]"
            aria-label="Theme share string"
          />
          {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" type="button" size="sm">
                Cancel
              </Button>
            }
          />
          <Button
            type="button"
            size="sm"
            disabled={value.trim().length === 0}
            onClick={handleSubmit}
          >
            Import
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
