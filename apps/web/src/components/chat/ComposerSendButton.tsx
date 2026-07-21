// FILE: ComposerSendButton.tsx
// Purpose: Render the composer submit button and pending spinner.
// Layer: Chat composer leaf UI

import { ComposerSendArrowIcon } from "~/lib/icons";

import { Button } from "../ui/button";

type SendButtonLabel =
  | "Connecting"
  | "Transcribing voice note"
  | "Preparing worktree"
  | "Sending"
  | "Send message";

export function ComposerSendButton({
  disabled,
  pending,
  ariaLabel,
}: {
  disabled: boolean;
  pending: boolean;
  ariaLabel: SendButtonLabel;
}) {
  return (
    <Button
      type="submit"
      variant="prominent"
      size="icon-xs"
      className="size-7 rounded-full sm:size-7"
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {pending ? (
        <svg
          width="12"
          height="12"
          viewBox="0 0 14 14"
          fill="none"
          className="animate-spin"
          aria-hidden="true"
        >
          <circle
            cx="7"
            cy="7"
            r="5.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="20 12"
          />
        </svg>
      ) : (
        <ComposerSendArrowIcon aria-hidden="true" className="size-5 shrink-0" />
      )}
    </Button>
  );
}
