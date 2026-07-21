// FILE: SidebarAddProjectPanel.tsx
// Purpose: Render the sidebar add-project chooser and manual-path form.
// Layer: Web sidebar leaf component

import { FolderIcon } from "~/lib/icons";
import { TbCursorText } from "react-icons/tb";
import { isElectron } from "../../env";
import type { SidebarProjectAccessOwner } from "../../hooks/useSidebarProjectAccessOwner";
import { SidebarGlyph } from "../sidebarGlyphs";

interface SidebarAddProjectPanelProps {
  readonly owner: SidebarProjectAccessOwner;
}

export function SidebarAddProjectPanel({ owner }: SidebarAddProjectPanelProps) {
  const { model, actions } = owner;
  if (!model.open) return null;

  return (
    <div className="mb-2.5 px-1">
      {!model.manualEntry ? (
        <div className="flex gap-1.5">
          {isElectron && (
            <button
              type="button"
              className="flex h-8 flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--color-background-elevated-secondary)] px-2 text-[length:var(--app-font-size-ui,12px)] font-normal text-[var(--color-text-foreground-secondary)] transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)] disabled:opacity-50"
              onClick={() => void actions.pickFolder()}
              disabled={model.pickingFolder || model.adding}
            >
              <SidebarGlyph icon={FolderIcon} variant="chrome" />
              {model.pickingFolder ? "Opening..." : model.adding ? "Adding..." : "Browse"}
            </button>
          )}
          <button
            type="button"
            className="flex h-8 flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--color-background-elevated-secondary)] px-2 text-[length:var(--app-font-size-ui,12px)] font-normal text-[var(--color-text-foreground-secondary)] transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)]"
            onClick={actions.showManual}
          >
            <SidebarGlyph icon={TbCursorText} variant="chrome" />
            Type path
          </button>
        </div>
      ) : (
        <div
          className={`flex items-center rounded-lg border bg-[var(--color-background-control-opaque)] transition-colors ${
            model.error
              ? "border-red-500/70 focus-within:border-red-500"
              : "border-[color:var(--color-border)] focus-within:border-[color:var(--color-border-focus)]"
          }`}
        >
          <input
            className="min-w-0 flex-1 bg-transparent pl-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            placeholder="/path/to/project"
            value={model.cwd}
            onChange={(event) => actions.setCwd(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") actions.submit();
              if (event.key === "Escape") actions.cancelManual();
            }}
            autoFocus
          />
          <button
            type="button"
            className="shrink-0 px-2.5 py-1.5 text-xs font-medium text-muted-foreground/50 transition-colors hover:text-foreground disabled:opacity-40"
            onClick={actions.submit}
            disabled={!model.canSubmit}
            aria-label="Add project"
          >
            {model.adding ? "..." : "↵"}
          </button>
        </div>
      )}
      {model.error && (
        <div className="mt-1 space-y-1 px-0.5">
          <p className="text-xs leading-tight text-red-400">{model.error}</p>
          {model.errorMeaning && (
            <p className="text-xs leading-tight text-muted-foreground/70">{model.errorMeaning}</p>
          )}
        </div>
      )}
    </div>
  );
}
