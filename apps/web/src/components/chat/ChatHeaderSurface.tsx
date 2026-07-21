// FILE: ChatHeaderSurface.tsx
// Purpose: Render the chat header shell without leaking layout conditions into ChatView.
// Layer: Chat shell presentation

import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";
import { ChatHeader } from "./ChatHeader";
import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "./chatHeaderControls";

export interface ChatHeaderSurfaceModel {
  shell: {
    isEditorRail: boolean;
    isElectron: boolean;
    desktopTopBarTrafficLightGutterClassName: string;
    desktopTopBarWindowControlsGutterClassName: string;
  };
  header: ComponentProps<typeof ChatHeader>;
}

export function ChatHeaderSurface({ model }: { model: ChatHeaderSurfaceModel }) {
  const { shell } = model;
  return (
    <header
      className={cn(
        CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
        !shell.isEditorRail && CHAT_SURFACE_HEADER_PADDING_X_CLASS,
        "flex items-center",
        shell.isEditorRail ? "h-10" : CHAT_SURFACE_HEADER_HEIGHT_CLASS,
        shell.isElectron && "drag-region",
        // The editor-rail chat header sits in the editor's second row (inside the
        // right-side chat pane), not flush against the window edges — the editor's
        // own top bar already reserves both desktop window-control gutters. Applying
        // them here just leaves redundant empty space on the sides.
        !shell.isEditorRail && shell.desktopTopBarTrafficLightGutterClassName,
        !shell.isEditorRail && shell.desktopTopBarWindowControlsGutterClassName,
      )}
    >
      <ChatHeader
        {...model.header}
        {...(shell.isEditorRail
          ? { className: cn(CHAT_SURFACE_HEADER_PADDING_X_CLASS, "h-full") }
          : {})}
      />
    </header>
  );
}
