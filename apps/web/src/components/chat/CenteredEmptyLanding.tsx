// FILE: CenteredEmptyLanding.tsx
// Purpose: Render the centered empty-chat heading and its composer content.
// Layer: Chat landing leaf UI

import type { ReactNode } from "react";
import { BotIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import {
  CHAT_COLUMN_FRAME_CLASS_NAME,
  CHAT_COLUMN_GUTTER_CLASS_NAME,
  COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME,
} from "./composerPickerStyles";

export function CenteredEmptyLanding({
  isHomeLanding,
  projectDisplayName,
  children,
}: {
  isHomeLanding: boolean;
  projectDisplayName: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "chat-pane-enter flex flex-1 items-center justify-center",
        CHAT_COLUMN_GUTTER_CLASS_NAME,
      )}
    >
      <div className="flex w-full flex-col justify-center">
        <div
          className={cn(
            "flex flex-col items-center gap-4 px-6 pb-5 text-center select-none",
            CHAT_COLUMN_FRAME_CLASS_NAME,
          )}
        >
          <div className="flex size-10 items-center justify-center rounded-2xl border border-border bg-foreground/[0.03]">
            <BotIcon aria-label="Agent Group" className="size-5 text-muted-foreground" />
          </div>
          <h2
            data-testid="empty-landing-heading"
            className="text-[26px] font-normal leading-[1.15] tracking-[-0.015em] text-foreground/95 sm:text-[30px]"
          >
            {isHomeLanding ? (
              "What should we work on?"
            ) : (
              <>
                What should we do in{" "}
                <span className={COMPOSER_MUTED_ACCENT_TEXT_CLASS_NAME}>
                  {projectDisplayName ?? "this folder"}
                </span>
                ?
              </>
            )}
          </h2>
        </div>
        {children}
      </div>
    </div>
  );
}
