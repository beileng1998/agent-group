// FILE: ComposerGoalHeader.tsx
// Purpose: Show and control the persistent goal stacked above the composer.
// Layer: Chat composer UI

import { useState } from "react";

import { useNowMs } from "~/hooks/useNowMs";
import { CheckIcon, FlagIcon, PauseIcon, PencilIcon, PlayIcon, Trash2 } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { formatClockDuration } from "../../session-logic";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { IconButton } from "../ui/icon-button";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  ComposerStackedPanelRow,
  ComposerStackedPanelRowLabel,
  ComposerStackedPanelRowMain,
} from "./ComposerStackedPanelContent";
import {
  COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_CLASS_NAME,
  COMPOSER_STACKED_PANEL_SCROLL_REGION_CLASS_NAME,
} from "./composerStackedPanelStyles";

export function goalElapsedMs(
  input: {
    readonly goalStartedAt?: string | null;
    readonly goalPausedAt?: string | null;
  },
  nowMs: number,
): number | null {
  const startedMs = Date.parse(input.goalStartedAt ?? "");
  if (!Number.isFinite(startedMs)) return null;
  const pausedMs = Date.parse(input.goalPausedAt ?? "");
  const endMs = Number.isFinite(pausedMs) ? pausedMs : nowMs;
  return Math.max(0, endMs - startedMs);
}

export interface ComposerGoalHeaderProps {
  goal: string;
  goalStartedAt?: string | null;
  goalPausedAt?: string | null;
  onEdit: () => void;
  onSetPaused: (paused: boolean) => void | Promise<void>;
  onAchieve: () => void | Promise<void>;
  onClear: () => void | Promise<void>;
  attachedToPrevious?: boolean;
}

export function ComposerGoalHeader(props: ComposerGoalHeaderProps) {
  const [open, setOpen] = useState(false);
  const paused = props.goalPausedAt != null;
  const nowMs = useNowMs(!paused && props.goalStartedAt != null);
  const elapsedMs = goalElapsedMs(props, nowMs);

  return (
    <ComposerStackedPanel
      attachedToPrevious={props.attachedToPrevious ?? false}
      data-testid="composer-goal-header"
    >
      <ComposerStackedPanelRow>
        <ComposerStackedPanelRowMain>
          <FlagIcon className={COMPOSER_STACKED_PANEL_ICON_CLASS_NAME} />
          <ComposerStackedPanelRowLabel className="shrink-0">
            {paused ? "Goal paused" : "Pursuing goal"}
          </ComposerStackedPanelRowLabel>
          {open ? null : (
            <span
              data-testid="composer-goal-preview"
              className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-muted-foreground/80 [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]"
            >
              {props.goal}
            </span>
          )}
          {elapsedMs !== null ? (
            <span className="shrink-0 tabular-nums text-muted-foreground/80">
              {formatClockDuration(elapsedMs)}
            </span>
          ) : null}
        </ComposerStackedPanelRowMain>
        <div className="flex shrink-0 items-center gap-0">
          <IconButton variant="ghost" size="icon-chip" label="Edit goal" onClick={props.onEdit}>
            <PencilIcon />
          </IconButton>
          <IconButton
            variant="ghost"
            size="icon-chip"
            label={paused ? "Resume goal" : "Pause goal"}
            onClick={() => void props.onSetPaused(!paused)}
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
          </IconButton>
          <IconButton
            variant="ghost"
            size="icon-chip"
            label="Complete goal"
            onClick={() => void props.onAchieve()}
          >
            <CheckIcon />
          </IconButton>
          <IconButton
            variant="ghost"
            size="icon-chip"
            label="Delete goal"
            onClick={() => void props.onClear()}
          >
            <Trash2 />
          </IconButton>
          <IconButton
            variant="ghost"
            size="icon-chip"
            label={open ? "Collapse goal" : "Expand goal"}
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            <DisclosureChevron open={open} />
          </IconButton>
        </div>
      </ComposerStackedPanelRow>
      <DisclosureRegion open={open}>
        <div
          className={cn(
            COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
            COMPOSER_STACKED_PANEL_SCROLL_REGION_CLASS_NAME,
          )}
        >
          <p className="whitespace-pre-wrap break-words text-[12px] text-muted-foreground/80">
            {props.goal}
          </p>
        </div>
      </DisclosureRegion>
    </ComposerStackedPanel>
  );
}
