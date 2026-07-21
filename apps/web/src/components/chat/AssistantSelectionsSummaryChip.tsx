// FILE: AssistantSelectionsSummaryChip.tsx
// Purpose: Renders the compact assistant-selection count chip used in composer and user bubbles.
// Layer: Chat attachment presentation

import { pluralize } from "@agent-group/shared/text";

import { MessageCircleIcon } from "~/lib/icons";
import { type ChatAssistantSelectionAttachment } from "../../types";
import { AttachmentSummaryChip } from "./AttachmentSummaryChip";

interface AssistantSelectionsSummaryChipProps {
  selections: ReadonlyArray<ChatAssistantSelectionAttachment>;
  onRemove?: (() => void) | undefined;
  onOpenSelection?: ((selection: ChatAssistantSelectionAttachment) => void) | undefined;
}

function selectionCountLabel(count: number): string {
  return `${count} ${pluralize(count, "selection")}`;
}

export function AssistantSelectionsSummaryChip(props: AssistantSelectionsSummaryChipProps) {
  if (props.selections.length === 0) {
    return null;
  }

  const sourceSelection = props.selections.length === 1 ? props.selections[0] : undefined;

  return (
    <AttachmentSummaryChip
      icon={MessageCircleIcon}
      label={selectionCountLabel(props.selections.length)}
      removeLabel="Remove selections"
      onRemove={props.onRemove}
      activateLabel={sourceSelection ? "Go to source selection" : undefined}
      onActivate={
        sourceSelection && props.onOpenSelection
          ? () => props.onOpenSelection?.(sourceSelection)
          : undefined
      }
      tooltip={props.selections.map((selection) => (
        <p key={selection.id} className="text-xs leading-relaxed">
          {selection.text}
        </p>
      ))}
    />
  );
}
