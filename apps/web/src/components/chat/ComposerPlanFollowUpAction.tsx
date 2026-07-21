// FILE: ComposerPlanFollowUpAction.tsx
// Purpose: Render refine/implement actions for a settled plan.
// Layer: Chat composer leaf UI

import { ChevronDownIcon } from "~/lib/icons";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";

export function ComposerPlanFollowUpAction({
  hasFeedback,
  busy,
  onImplementInNewThread,
}: {
  hasFeedback: boolean;
  busy: boolean;
  onImplementInNewThread: () => Promise<void> | void;
}) {
  if (hasFeedback) {
    return (
      <Button type="submit" size="sm" className="h-9 rounded-full px-4 sm:h-8" disabled={busy}>
        {busy ? "Sending..." : "Refine"}
      </Button>
    );
  }

  return (
    <div className="flex items-center">
      <Button
        type="submit"
        size="sm"
        className="h-9 rounded-l-full rounded-r-none px-4 sm:h-8"
        disabled={busy}
      >
        {busy ? "Sending..." : "Implement"}
      </Button>
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="sm"
              variant="default"
              className="h-9 rounded-l-none rounded-r-full border-l-white/12 px-2 sm:h-8"
              aria-label="Implementation actions"
              disabled={busy}
            />
          }
        >
          <ChevronDownIcon className="size-3.5" />
        </MenuTrigger>
        <ComposerPickerMenuPopup align="end" side="top">
          <MenuItem disabled={busy} onClick={() => void onImplementInNewThread()}>
            Implement in a new thread
          </MenuItem>
        </ComposerPickerMenuPopup>
      </Menu>
    </div>
  );
}
