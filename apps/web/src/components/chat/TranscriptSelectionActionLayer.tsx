// FILE: TranscriptSelectionActionLayer.tsx
// Purpose: Renders the transcript selection floating action from controller state.
// Layer: Chat transcript interaction UI

import { type PendingTranscriptSelectionAction } from "./useTranscriptAssistantSelectionAction";
import { TranscriptSelectionAction } from "./TranscriptSelectionAction";

interface TranscriptSelectionActionLayerProps {
  action: PendingTranscriptSelectionAction | null;
  onHighlight: () => void;
  onAddToChat: () => void;
  onAddToSidechat?: () => void;
  onAskInSidechat?: () => void;
}

export function TranscriptSelectionActionLayer(props: TranscriptSelectionActionLayerProps) {
  if (!props.action) {
    return null;
  }

  return (
    <TranscriptSelectionAction
      left={props.action.left}
      top={props.action.top}
      placement={props.action.placement}
      onHighlight={props.onHighlight}
      onAddToChat={props.onAddToChat}
      {...(props.onAddToSidechat ? { onAddToSidechat: props.onAddToSidechat } : {})}
      {...(props.onAskInSidechat ? { onAskInSidechat: props.onAskInSidechat } : {})}
    />
  );
}
