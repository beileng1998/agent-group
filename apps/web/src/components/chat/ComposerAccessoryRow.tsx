// FILE: ComposerAccessoryRow.tsx
// Purpose: Align relocated composer controls with the optional branch toolbar.
// Layer: Chat composer leaf UI

import type { ReactNode } from "react";

import {
  CHAT_COLUMN_GUTTER_CLASS_NAME,
  COMPOSER_COLUMN_FRAME_CLASS_NAME,
} from "./composerPickerStyles";

export function ComposerAccessoryRow({
  variant,
  leadingControls,
  branchToolbar,
}: {
  variant: "landing" | "transcript";
  leadingControls: ReactNode | null;
  branchToolbar: ReactNode | null;
}) {
  if (!leadingControls && !branchToolbar) return null;

  const row = (
    <div className={COMPOSER_COLUMN_FRAME_CLASS_NAME}>
      <div className="flex w-full items-center gap-1">
        {leadingControls ? (
          <div className="flex shrink-0 items-center gap-1 pl-1">{leadingControls}</div>
        ) : null}
        {branchToolbar}
      </div>
    </div>
  );

  return variant === "transcript" ? (
    <div className={CHAT_COLUMN_GUTTER_CLASS_NAME}>{row}</div>
  ) : (
    row
  );
}
