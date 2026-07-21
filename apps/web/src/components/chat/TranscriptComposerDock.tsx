// FILE: TranscriptComposerDock.tsx
// Purpose: Position the transcript composer above the bottom edge and environment inset.
// Layer: Chat composer leaf UI

import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

import {
  CHAT_COLUMN_GUTTER_CLASS_NAME,
  ENVIRONMENT_CONTENT_INSET_MOTION_CLASS,
} from "./composerPickerStyles";

export function TranscriptComposerDock({
  hasTrailingToolbar,
  rightInsetPx,
  children,
}: {
  hasTrailingToolbar: boolean;
  rightInsetPx?: number;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative z-10 -mt-5 w-full shrink-0 overflow-visible pt-0 sm:pt-0",
        ENVIRONMENT_CONTENT_INSET_MOTION_CLASS,
        CHAT_COLUMN_GUTTER_CLASS_NAME,
        hasTrailingToolbar ? "pb-0.5" : "pb-3 sm:pb-4",
      )}
      style={rightInsetPx === undefined ? undefined : { paddingRight: rightInsetPx }}
    >
      {children}
    </div>
  );
}
