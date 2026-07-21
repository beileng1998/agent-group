// FILE: ChatEmptyStateHero.tsx
// Purpose: Render the centered empty-state hero for blank transcripts.
// Layer: Chat presentation
// Depends on: the caller-supplied project display name.

import { memo } from "react";
import { BotIcon } from "~/lib/icons";

export const ChatEmptyStateHero = memo(function ChatEmptyStateHero({
  projectName,
}: {
  projectName: string | undefined;
}) {
  return (
    <div className="flex flex-col items-center gap-5 select-none">
      <div
        aria-label="Agent Group"
        className="flex size-10 items-center justify-center rounded-2xl border border-border bg-foreground/[0.03]"
      >
        <BotIcon className="size-5 text-muted-foreground" />
      </div>

      <div className="flex flex-col items-center gap-0.5">
        <h1 className="text-2xl font-semibold text-foreground/90">Let's build</h1>
        {projectName && <span className="text-lg text-muted-foreground/40">{projectName}</span>}
      </div>
    </div>
  );
});
