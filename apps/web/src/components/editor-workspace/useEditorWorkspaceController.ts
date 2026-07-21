import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { EditorActivityBarItem, EditorCenterMode } from "./editorWorkspaceTypes";

export const EDITOR_CHAT_PANE_MIN_WIDTH = 320;
export const EDITOR_CHAT_PANE_MAX_WIDTH = 600;

const EDITOR_CHAT_PANE_STORAGE_KEY = "agent-group.editor.chatPaneWidth";
const EDITOR_SIDEBAR_VISIBLE_STORAGE_KEY = "agent-group.editor.sidebarVisible";
const EDITOR_CHAT_PANE_VISIBLE_STORAGE_KEY = "agent-group.editor.chatPaneVisible";
const EDITOR_CHAT_PANE_DEFAULT_WIDTH = 384;
const EDITOR_CHAT_PANE_KEYBOARD_STEP = 24;

interface EditorChatPaneResizeState {
  pointerId: number;
  startX: number;
  startWidth: number;
  pendingWidth: number;
  rafId: number | null;
  restoreBodyCursor: string;
  restoreBodyUserSelect: string;
  onPointerMove: (event: PointerEvent) => void;
  onPointerEnd: (event: PointerEvent) => void;
}

function clampEditorChatPaneWidth(width: number): number {
  return Math.min(
    EDITOR_CHAT_PANE_MAX_WIDTH,
    Math.max(EDITOR_CHAT_PANE_MIN_WIDTH, Math.round(width)),
  );
}

function readStoredEditorChatPaneWidth(): number {
  if (typeof window === "undefined") {
    return EDITOR_CHAT_PANE_DEFAULT_WIDTH;
  }

  try {
    const rawValue = window.localStorage.getItem(EDITOR_CHAT_PANE_STORAGE_KEY);
    const parsed = rawValue === null ? Number.NaN : Number.parseFloat(rawValue);
    return Number.isFinite(parsed)
      ? clampEditorChatPaneWidth(parsed)
      : EDITOR_CHAT_PANE_DEFAULT_WIDTH;
  } catch {
    return EDITOR_CHAT_PANE_DEFAULT_WIDTH;
  }
}

function storeEditorChatPaneWidth(width: number): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      EDITOR_CHAT_PANE_STORAGE_KEY,
      String(clampEditorChatPaneWidth(width)),
    );
  } catch {
    // Best-effort preference persistence only.
  }
}

function readStoredEditorVisibility(key: string): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    return window.localStorage.getItem(key) !== "false";
  } catch {
    return true;
  }
}

function storeEditorVisibility(key: string, visible: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, String(visible));
  } catch {
    // Best-effort preference persistence only.
  }
}

export function useEditorWorkspaceController(input: {
  centerMode: EditorCenterMode;
  onCenterModeChange: (mode: EditorCenterMode) => void;
}) {
  const [chatPaneWidth, setChatPaneWidth] = useState(readStoredEditorChatPaneWidth);
  const chatPaneResizeStateRef = useRef<EditorChatPaneResizeState | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(() =>
    readStoredEditorVisibility(EDITOR_SIDEBAR_VISIBLE_STORAGE_KEY),
  );
  const [chatPaneVisible, setChatPaneVisible] = useState(() =>
    readStoredEditorVisibility(EDITOR_CHAT_PANE_VISIBLE_STORAGE_KEY),
  );
  const [searchPaneActive, setSearchPaneActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const selectActivityBarItem = useCallback(
    (item: EditorActivityBarItem) => {
      const itemActive =
        sidebarVisible &&
        (item === "search" ? searchPaneActive : !searchPaneActive && input.centerMode === item);
      if (itemActive) {
        setSidebarVisible(false);
        storeEditorVisibility(EDITOR_SIDEBAR_VISIBLE_STORAGE_KEY, false);
        return;
      }
      if (!sidebarVisible) {
        setSidebarVisible(true);
        storeEditorVisibility(EDITOR_SIDEBAR_VISIBLE_STORAGE_KEY, true);
      }
      if (item === "search") {
        setSearchPaneActive(true);
        return;
      }
      setSearchPaneActive(false);
      input.onCenterModeChange(item);
    },
    [input, searchPaneActive, sidebarVisible],
  );

  const toggleChatPaneVisible = useCallback(() => {
    setChatPaneVisible((previous) => {
      const next = !previous;
      storeEditorVisibility(EDITOR_CHAT_PANE_VISIBLE_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const stopChatPaneResize = useCallback(() => {
    const resizeState = chatPaneResizeStateRef.current;
    if (!resizeState || typeof window === "undefined") {
      return;
    }

    if (resizeState.rafId !== null) {
      window.cancelAnimationFrame(resizeState.rafId);
      resizeState.rafId = null;
    }

    window.removeEventListener("pointermove", resizeState.onPointerMove);
    window.removeEventListener("pointerup", resizeState.onPointerEnd);
    window.removeEventListener("pointercancel", resizeState.onPointerEnd);
    document.body.style.cursor = resizeState.restoreBodyCursor;
    document.body.style.userSelect = resizeState.restoreBodyUserSelect;
    setChatPaneWidth(resizeState.pendingWidth);
    storeEditorChatPaneWidth(resizeState.pendingWidth);
    chatPaneResizeStateRef.current = null;
  }, []);

  useEffect(() => stopChatPaneResize, [stopChatPaneResize]);

  const handleChatPaneResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || typeof window === "undefined") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      stopChatPaneResize();

      const resizeState: EditorChatPaneResizeState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: chatPaneWidth,
        pendingWidth: chatPaneWidth,
        rafId: null,
        restoreBodyCursor: document.body.style.cursor,
        restoreBodyUserSelect: document.body.style.userSelect,
        onPointerMove: () => undefined,
        onPointerEnd: () => undefined,
      };

      resizeState.onPointerMove = (moveEvent) => {
        if (moveEvent.pointerId !== resizeState.pointerId) {
          return;
        }

        resizeState.pendingWidth = clampEditorChatPaneWidth(
          resizeState.startWidth + resizeState.startX - moveEvent.clientX,
        );
        if (resizeState.rafId !== null) {
          return;
        }
        resizeState.rafId = window.requestAnimationFrame(() => {
          resizeState.rafId = null;
          setChatPaneWidth(resizeState.pendingWidth);
        });
      };

      resizeState.onPointerEnd = (endEvent) => {
        if (endEvent.pointerId === resizeState.pointerId) {
          stopChatPaneResize();
        }
      };

      chatPaneResizeStateRef.current = resizeState;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", resizeState.onPointerMove);
      window.addEventListener("pointerup", resizeState.onPointerEnd);
      window.addEventListener("pointercancel", resizeState.onPointerEnd);
    },
    [chatPaneWidth, stopChatPaneResize],
  );

  const handleChatPaneResizeDoubleClick = useCallback(() => {
    setChatPaneWidth(EDITOR_CHAT_PANE_DEFAULT_WIDTH);
    storeEditorChatPaneWidth(EDITOR_CHAT_PANE_DEFAULT_WIDTH);
  }, []);

  const handleChatPaneResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      let nextWidth: number | null = null;
      if (event.key === "ArrowLeft") {
        nextWidth = chatPaneWidth + EDITOR_CHAT_PANE_KEYBOARD_STEP;
      } else if (event.key === "ArrowRight") {
        nextWidth = chatPaneWidth - EDITOR_CHAT_PANE_KEYBOARD_STEP;
      } else if (event.key === "Home") {
        nextWidth = EDITOR_CHAT_PANE_MIN_WIDTH;
      } else if (event.key === "End") {
        nextWidth = EDITOR_CHAT_PANE_MAX_WIDTH;
      }
      if (nextWidth === null) {
        return;
      }

      event.preventDefault();
      const clampedWidth = clampEditorChatPaneWidth(nextWidth);
      setChatPaneWidth(clampedWidth);
      storeEditorChatPaneWidth(clampedWidth);
    },
    [chatPaneWidth],
  );

  return {
    chatPaneWidth,
    chatPaneVisible,
    sidebarVisible,
    searchPaneActive,
    searchQuery,
    setSearchQuery,
    selectActivityBarItem,
    toggleChatPaneVisible,
    handleChatPaneResizePointerDown,
    handleChatPaneResizeDoubleClick,
    handleChatPaneResizeKeyDown,
  };
}
