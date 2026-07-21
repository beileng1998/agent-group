// FILE: TerminalWorkspaceLayer.tsx
// Purpose: Animate and isolate the full chat terminal workspace layer.
// Layer: Chat terminal leaf UI

import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

import { DISCLOSURE_CONTENT_MOTION_CLASS } from "../../lib/disclosureMotion";

export function TerminalWorkspaceLayer({
  open,
  active,
  children,
}: {
  open: boolean;
  active: boolean;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div
      aria-hidden={!active}
      inert={!active}
      className={cn(
        "absolute inset-0 min-h-0 min-w-0",
        DISCLOSURE_CONTENT_MOTION_CLASS,
        active ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1 opacity-0",
      )}
    >
      {children}
    </div>
  );
}
