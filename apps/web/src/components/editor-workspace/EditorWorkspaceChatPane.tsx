import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";

import { cn } from "~/lib/utils";

import {
  EDITOR_CHAT_PANE_MAX_WIDTH,
  EDITOR_CHAT_PANE_MIN_WIDTH,
} from "./useEditorWorkspaceController";

export function EditorWorkspaceChatPane(props: {
  visible: boolean;
  width: number;
  children: ReactNode;
  onResizePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeDoubleClick: () => void;
  onResizeKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <>
      <div
        role="separator"
        aria-label="Resize chat panel"
        aria-orientation="vertical"
        aria-valuemin={EDITOR_CHAT_PANE_MIN_WIDTH}
        aria-valuemax={EDITOR_CHAT_PANE_MAX_WIDTH}
        aria-valuenow={props.width}
        tabIndex={0}
        title="Drag to resize chat panel"
        className={cn(
          "group relative z-10 w-0 shrink-0 cursor-col-resize outline-none",
          props.visible ? "hidden lg:block" : "hidden",
        )}
        onPointerDown={props.onResizePointerDown}
        onDoubleClick={props.onResizeDoubleClick}
        onKeyDown={props.onResizeKeyDown}
      >
        <span
          className="absolute inset-y-0 left-[-3px] w-1.5 cursor-col-resize bg-transparent transition-colors group-hover:bg-[var(--color-background-button-secondary-hover)] group-focus-visible:bg-[var(--color-background-button-secondary-hover)]"
          aria-hidden="true"
        />
        <span
          className="pointer-events-none absolute inset-y-0 left-0 w-px bg-[var(--app-surface-divider)] transition-colors group-hover:bg-[var(--color-text-accent)] group-focus-visible:bg-[var(--color-text-accent)]"
          aria-hidden="true"
        />
      </div>
      {/* Hidden (not unmounted) so the chat runtime and composer focus survive. */}
      <aside
        className={cn(
          "min-h-[18rem] w-full shrink-0 bg-[var(--color-background-surface)] lg:h-full lg:w-[var(--editor-chat-pane-width)]",
          props.visible ? "flex" : "hidden",
        )}
        style={
          {
            "--editor-chat-pane-width": `${props.width}px`,
          } as CSSProperties
        }
      >
        {props.children}
      </aside>
    </>
  );
}
