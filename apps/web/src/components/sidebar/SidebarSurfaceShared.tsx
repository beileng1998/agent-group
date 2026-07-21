// FILE: SidebarSurfaceShared.tsx
// Purpose: Shared section header and pinned-thread block for sidebar product surfaces.
// Layer: Web sidebar presentation

import type { ReactNode } from "react";
import type { SidebarThreadSummary } from "../../types";
import { SIDEBAR_SECTION_LABEL_CLASS_NAME } from "../../sidebarRowStyles";
import { cn } from "../../lib/utils";
import { SidebarSectionToolbar } from "../SidebarSectionToolbar";

export function SidebarSurfaceSectionHeader({
  label,
  toolbar,
}: {
  label: string;
  toolbar: ReactNode;
}) {
  return (
    <div className="group/project-header relative my-1">
      <div
        className={cn(
          "flex h-7 w-full min-w-0 items-center px-2 py-0.5 pr-[4.75rem]",
          SIDEBAR_SECTION_LABEL_CLASS_NAME,
        )}
      >
        <span className="truncate">{label}</span>
      </div>
      <SidebarSectionToolbar placement="overlay" revealOnHover>
        {toolbar}
      </SidebarSectionToolbar>
    </div>
  );
}

export function SidebarPinnedThreadsSection({
  threads,
  renderThread,
}: {
  threads: readonly SidebarThreadSummary[];
  renderThread: (thread: SidebarThreadSummary) => ReactNode;
}) {
  if (threads.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="my-1 flex items-center justify-between px-2 py-1">
        <span className={SIDEBAR_SECTION_LABEL_CLASS_NAME}>Pinned</span>
      </div>
      <div className="flex flex-col gap-0.5">{threads.map(renderThread)}</div>
    </div>
  );
}
