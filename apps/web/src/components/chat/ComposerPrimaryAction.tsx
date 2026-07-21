// FILE: ComposerPrimaryAction.tsx
// Purpose: Render the single highest-priority action at the right edge of the composer.
// Layer: Chat composer UI

import type { ComponentProps } from "react";

import { Button } from "../ui/button";
import { ComposerPlanFollowUpAction } from "./ComposerPlanFollowUpAction";
import { ComposerSendButton } from "./ComposerSendButton";
import { ComposerVoiceButton } from "./ComposerVoiceButton";

export type ComposerPrimaryActionModel =
  | { kind: "pending-input"; disabled: boolean; label: string }
  | { kind: "interrupt"; onInterrupt: () => Promise<void> | void }
  | {
      kind: "plan-follow-up";
      props: ComponentProps<typeof ComposerPlanFollowUpAction>;
    }
  | {
      kind: "send";
      voice: ComponentProps<typeof ComposerVoiceButton> | null;
      send: ComponentProps<typeof ComposerSendButton>;
    }
  | { kind: "none" };

export function ComposerPrimaryAction({ action }: { action: ComposerPrimaryActionModel }) {
  switch (action.kind) {
    case "pending-input":
      return (
        <Button type="submit" size="sm" className="rounded-full px-4" disabled={action.disabled}>
          {action.label}
        </Button>
      );
    case "interrupt":
      return (
        <Button
          type="button"
          variant="prominent"
          size="icon-xs"
          className="sm:size-[26px]"
          onClick={() => void action.onInterrupt()}
          aria-label="Stop generation"
          title="Stop the current response. On Mac, press Ctrl+C to interrupt."
        >
          <span aria-hidden="true" className="block size-2 rounded-[1px] bg-current" />
        </Button>
      );
    case "plan-follow-up":
      return <ComposerPlanFollowUpAction {...action.props} />;
    case "send":
      return (
        <>
          {action.voice ? <ComposerVoiceButton {...action.voice} /> : null}
          <ComposerSendButton {...action.send} />
        </>
      );
    case "none":
      return null;
  }
}
