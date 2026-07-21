// FILE: ContinueInMenuItem.tsx
// Purpose: Shared glyph and menu-row presentation for workspace handoff choices.
// Layer: Web branch toolbar UI

import type { ReactNode } from "react";
import { CheckIcon, WorktreeIcon } from "~/lib/icons";
import { MenuItem } from "../ui/menu";

export const ENV_MENU_ICON_CLASS_NAME = "size-3.5 text-muted-foreground";

export function WorktreeGlyph({ className }: { className?: string }) {
  return <WorktreeIcon className={className} />;
}

export function ContinueInMenuItem({
  icon,
  label,
  selected = false,
  disabled = false,
  onSelect,
}: {
  icon: ReactNode;
  label: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  return (
    <MenuItem disabled={disabled} {...(onSelect ? { onClick: onSelect } : {})}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected ? (
        <CheckIcon className="size-3.5 shrink-0 text-[var(--color-text-foreground)]" />
      ) : null}
    </MenuItem>
  );
}
