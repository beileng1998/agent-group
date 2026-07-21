// FILE: ComposerStackedActivityRail.tsx
// Purpose: Render and measure the ordered activity panels above the composer input.
// Layer: Chat composer UI

import type { ComponentProps, Ref } from "react";

import { ComposerActiveTaskListCard } from "./ComposerActiveTaskListCard";
import { ComposerLiveChangesHeader } from "./ComposerLiveChangesHeader";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";
import { ComposerQueuedHeader } from "./ComposerQueuedHeader";

export type ComposerPendingActivityModel =
  | {
      kind: "approval";
      props: ComponentProps<typeof ComposerPendingApprovalPanel>;
    }
  | {
      kind: "user-input";
      props: ComponentProps<typeof ComposerPendingUserInputPanel>;
    }
  | null;

export function ComposerStackedActivityRail(props: {
  measureRef: Ref<HTMLDivElement>;
  liveChanges: ComponentProps<typeof ComposerLiveChangesHeader> | null;
  taskList: ComponentProps<typeof ComposerActiveTaskListCard> | null;
  queue: ComponentProps<typeof ComposerQueuedHeader>;
  pending: ComposerPendingActivityModel;
}) {
  return (
    <div ref={props.measureRef}>
      {props.liveChanges ? <ComposerLiveChangesHeader {...props.liveChanges} /> : null}
      {props.taskList ? <ComposerActiveTaskListCard {...props.taskList} /> : null}
      <ComposerQueuedHeader {...props.queue} />
      {props.pending ? (
        <div className="pb-2">
          {props.pending.kind === "approval" ? (
            <ComposerPendingApprovalPanel {...props.pending.props} />
          ) : (
            <ComposerPendingUserInputPanel {...props.pending.props} />
          )}
        </div>
      ) : null}
    </div>
  );
}
