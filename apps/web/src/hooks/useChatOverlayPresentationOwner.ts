import type { ThreadMarker, ThreadMarkerColor } from "@agent-group/contracts";

import { AGENT_GROUP_CAPABILITIES } from "../agentGroupCapabilities";
import type {
  ChatDialogLayerModel,
  ChatOverlayLayerModel,
} from "../components/chat/ChatOverlayLayer";

type AutomationDialogModel = NonNullable<ChatDialogLayerModel["automation"]>;
type WorktreeHandoffModel = NonNullable<ChatOverlayLayerModel["worktreeHandoff"]>;
type SelectionActionModel = NonNullable<ChatOverlayLayerModel["selection"]>;
type MarkerEditModel = NonNullable<ChatOverlayLayerModel["marker"]>;
type ExpandedImageModel = NonNullable<ChatOverlayLayerModel["image"]>;

export interface ChatOverlayPresentationInput {
  dialog: {
    rename: ChatDialogLayerModel["rename"];
    automation: AutomationDialogModel | null;
  };
  slash: ChatOverlayLayerModel["slashStatus"];
  worktree: {
    handoff: WorktreeHandoffModel | null;
  };
  selection: {
    inactiveSplitPane: boolean;
    action: SelectionActionModel["action"];
    onHighlight: SelectionActionModel["onHighlight"];
    onAddToChat: SelectionActionModel["onAddToChat"];
    hasVisibleSidechatTarget: boolean;
    onAddToSidechat: NonNullable<SelectionActionModel["onAddToSidechat"]>;
    isTemporarySidechat: boolean;
    onAskInSidechat: NonNullable<SelectionActionModel["onAskInSidechat"]>;
  };
  marker: {
    record: Pick<ThreadMarker, "id" | "color" | "note"> | null;
    anchorRect: DOMRect | null;
    onColorChange: (markerId: ThreadMarker["id"], color: ThreadMarkerColor) => void;
    onNoteChange: (markerId: ThreadMarker["id"], note: string | null) => void;
    onRemove: (markerId: ThreadMarker["id"]) => void;
    onClose: MarkerEditModel["onClose"];
  };
  image: {
    preview: ExpandedImageModel["preview"] | null;
    onClose: ExpandedImageModel["onClose"];
    onNavigate: ExpandedImageModel["onNavigate"];
  };
}

export function buildChatOverlayPresentation(input: ChatOverlayPresentationInput): {
  dialogLayerModel: ChatDialogLayerModel;
  overlayLayerModel: ChatOverlayLayerModel;
} {
  const markerRecord = input.marker.record;

  return {
    dialogLayerModel: {
      rename: input.dialog.rename,
      automation:
        AGENT_GROUP_CAPABILITIES.automations && input.dialog.automation
          ? input.dialog.automation
          : null,
    },
    overlayLayerModel: {
      slashStatus: input.slash,
      worktreeHandoff:
        AGENT_GROUP_CAPABILITIES.worktrees && input.worktree.handoff
          ? input.worktree.handoff
          : null,
      selection: input.selection.inactiveSplitPane
        ? null
        : {
            action: input.selection.action,
            onHighlight: input.selection.onHighlight,
            onAddToChat: input.selection.onAddToChat,
            ...(input.selection.hasVisibleSidechatTarget
              ? { onAddToSidechat: input.selection.onAddToSidechat }
              : {}),
            ...(AGENT_GROUP_CAPABILITIES.sidechat && !input.selection.isTemporarySidechat
              ? { onAskInSidechat: input.selection.onAskInSidechat }
              : {}),
          },
      marker: markerRecord
        ? {
            color: markerRecord.color,
            note: markerRecord.note ?? null,
            anchorRect: input.marker.anchorRect!,
            onColorChange: (color) => input.marker.onColorChange(markerRecord.id, color),
            onNoteChange: (note) => input.marker.onNoteChange(markerRecord.id, note),
            onRemove: () => {
              input.marker.onRemove(markerRecord.id);
              input.marker.onClose();
            },
            onClose: input.marker.onClose,
          }
        : null,
      image: input.image.preview
        ? {
            preview: input.image.preview,
            onClose: input.image.onClose,
            onNavigate: input.image.onNavigate,
          }
        : null,
    },
  };
}
