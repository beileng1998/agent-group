// FILE: EmptyLandingControlsTray.tsx
// Purpose: Render project, branch, and temporary controls below the landing composer.
// Layer: Chat landing leaf UI

import type { ReactNode } from "react";
import { TemporaryThreadIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { COMPOSER_COLUMN_FRAME_CLASS_NAME } from "./composerPickerStyles";

interface LandingBranchControl {
  control: ReactNode;
  temporary: boolean;
  onToggleTemporary: () => void;
}

export function EmptyLandingControlsTray({
  projectControl,
  branch,
}: {
  projectControl: ReactNode;
  branch: LandingBranchControl | null;
}) {
  return (
    <div
      className={cn(
        "chat-composer-shell relative z-0 -mt-5 flex min-h-8 min-w-0 flex-nowrap items-center gap-x-1.5 overflow-hidden !rounded-t-none !rounded-b-[var(--composer-radius)] bg-[color-mix(in_srgb,var(--color-background-elevated-secondary)_76%,var(--color-background-surface)_24%)] px-2 pb-1.5 pt-6 transition-colors duration-150 ease-out motion-reduce:transition-none sm:min-h-7",
        COMPOSER_COLUMN_FRAME_CLASS_NAME,
      )}
    >
      {projectControl}
      <div
        aria-hidden={branch ? undefined : true}
        className={cn(
          "flex min-w-0 flex-1 items-center transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
          branch ? "translate-y-0 opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {branch?.control ?? null}
      </div>
      {branch ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={branch.temporary}
          onClick={branch.onToggleTemporary}
          title={
            branch.temporary
              ? "Temporary chat — deleted when you leave. Click to keep it."
              : "Make this a temporary chat (deleted when you leave)"
          }
          aria-label="Temporary chat"
          className={cn(
            "ml-auto shrink-0 gap-1.5 whitespace-nowrap px-2 text-[length:var(--app-font-size-ui-sm,11px)] font-normal transition-colors sm:px-2.5",
            branch.temporary
              ? "text-[var(--color-text-accent)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-accent)]"
              : "text-[var(--color-text-foreground-secondary)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)]",
          )}
        >
          <TemporaryThreadIcon className="size-3.5" />
          <span className="sr-only sm:not-sr-only">Temporary</span>
        </Button>
      ) : null}
    </div>
  );
}
