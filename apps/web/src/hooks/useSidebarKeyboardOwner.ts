// FILE: useSidebarKeyboardOwner.ts
// Purpose: Own sidebar shortcuts, thread-jump hints, and search-palette state/read models.
// Layer: Web sidebar controller

import type { ResolvedKeybindingsConfig, ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  splitShortcutLabel,
  shouldShowThreadJumpHints,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
} from "../keybindings";
import { getInitialBrowseQuery } from "../lib/projectPaths";
import { isMacPlatform } from "../lib/utils";
import { isTerminalFocused } from "../lib/terminalFocus";
import {
  buildThreadJumpLabelMap,
  EMPTY_THREAD_JUMP_LABELS,
  threadJumpLabelMapsEqual,
} from "../components/sidebar/SidebarThreadJumpLabels";
import { getNextVisibleSidebarThreadId } from "../components/Sidebar.visibilityLogic";
import type {
  SidebarSearchAction,
  SidebarSearchProject,
} from "../components/SidebarSearchPalette.logic";
import type { SidebarSearchPaletteMode } from "../components/SidebarSearchPalette";
import type { Project } from "../types";

interface UseSidebarKeyboardOwnerInput {
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly projects: readonly Project[];
  readonly visibleThreadIds: readonly ThreadId[];
  readonly activeThreadId: ThreadId | null;
  readonly terminalOpen: boolean;
  readonly terminalWorkspaceOpen: boolean;
  readonly homeDir: string | null;
  readonly activateThread: (threadId: ThreadId) => void;
  readonly openUsageSettings: () => void;
}

export function useSidebarKeyboardOwner({
  keybindings,
  projects,
  visibleThreadIds,
  activeThreadId,
  terminalOpen,
  terminalWorkspaceOpen,
  homeDir,
  activateThread,
  openUsageSettings,
}: UseSidebarKeyboardOwnerInput) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<SidebarSearchPaletteMode>("search");
  const [paletteInitialQuery, setPaletteInitialQuery] = useState<string | null>(null);
  const [threadJumpLabelByThreadId, setThreadJumpLabelByThreadId] =
    useState<ReadonlyMap<ThreadId, string>>(EMPTY_THREAD_JUMP_LABELS);
  const threadJumpLabelsRef = useRef<ReadonlyMap<ThreadId, string>>(EMPTY_THREAD_JUMP_LABELS);
  threadJumpLabelsRef.current = threadJumpLabelByThreadId;
  const [showThreadJumpHints, setShowThreadJumpHints] = useState(false);
  const showThreadJumpHintsRef = useRef(false);
  showThreadJumpHintsRef.current = showThreadJumpHints;

  const threadJumpCommandByThreadId = useMemo(() => {
    const mapping = new Map<ThreadId, NonNullable<ReturnType<typeof threadJumpCommandForIndex>>>();
    for (const [index, threadId] of visibleThreadIds.entries()) {
      const command = threadJumpCommandForIndex(index);
      if (!command) break;
      mapping.set(threadId, command);
    }
    return mapping;
  }, [visibleThreadIds]);
  const threadJumpThreadIds = useMemo(
    () => [...threadJumpCommandByThreadId.keys()],
    [threadJumpCommandByThreadId],
  );
  const getShortcutContext = useCallback(
    () => ({
      terminalFocus: isTerminalFocused(),
      terminalOpen,
      terminalWorkspaceOpen,
    }),
    [terminalOpen, terminalWorkspaceOpen],
  );
  const visibleThreadJumpLabelByThreadId = showThreadJumpHints
    ? threadJumpLabelByThreadId
    : EMPTY_THREAD_JUMP_LABELS;
  const visibleThreadJumpLabelPartsByThreadId = useMemo(() => {
    const result = new Map<ThreadId, readonly string[]>();
    for (const [threadId, label] of visibleThreadJumpLabelByThreadId) {
      result.set(threadId, splitShortcutLabel(label));
    }
    return result;
  }, [visibleThreadJumpLabelByThreadId]);

  useEffect(() => {
    const clearThreadJumpHints = () => {
      setThreadJumpLabelByThreadId((current) =>
        current === EMPTY_THREAD_JUMP_LABELS ? current : EMPTY_THREAD_JUMP_LABELS,
      );
      setShowThreadJumpHints(false);
    };
    const shouldIgnoreThreadJumpHintUpdate = (event: KeyboardEvent) =>
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      event.key !== "Meta" &&
      event.key !== "Control" &&
      event.key !== "Alt" &&
      event.key !== "Shift" &&
      !showThreadJumpHintsRef.current &&
      threadJumpLabelsRef.current === EMPTY_THREAD_JUMP_LABELS;
    const updateThreadJumpHints = (event: KeyboardEvent) => {
      const shortcutContext = getShortcutContext();
      const shouldShowHints = shouldShowThreadJumpHints(event, keybindings, {
        platform: navigator.platform,
        context: shortcutContext,
      });
      if (!shouldShowHints) {
        clearThreadJumpHints();
        return;
      }
      setThreadJumpLabelByThreadId((current) => {
        const next = buildThreadJumpLabelMap({
          keybindings,
          platform: navigator.platform,
          terminalOpen: shortcutContext.terminalOpen,
          threadJumpCommandByThreadId,
        });
        return threadJumpLabelMapsEqual(current, next) ? current : next;
      });
      setShowThreadJumpHints(true);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "k" &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        setPaletteMode("search");
        setPaletteInitialQuery(null);
        setPaletteOpen((previous) => !previous || paletteMode !== "search");
        return;
      }

      const shortcutContext = getShortcutContext();
      if (!shouldIgnoreThreadJumpHintUpdate(event)) {
        const shouldShowHints = shouldShowThreadJumpHints(event, keybindings, {
          platform: navigator.platform,
          context: shortcutContext,
        });
        if (!shouldShowHints) {
          if (
            showThreadJumpHintsRef.current ||
            threadJumpLabelsRef.current !== EMPTY_THREAD_JUMP_LABELS
          )
            clearThreadJumpHints();
        } else {
          updateThreadJumpHints(event);
        }
      }

      const command = resolveShortcutCommand(event, keybindings, { context: shortcutContext });
      if (command === "sidebar.search") {
        event.preventDefault();
        event.stopPropagation();
        setPaletteMode("search");
        setPaletteInitialQuery(null);
        setPaletteOpen((previous) => !previous || paletteMode !== "search");
        return;
      }
      if (command === "sidebar.addProject") {
        event.preventDefault();
        event.stopPropagation();
        setPaletteMode("search");
        setPaletteInitialQuery(getInitialBrowseQuery(homeDir));
        setPaletteOpen(true);
        return;
      }
      if (command === "sidebar.importThread") {
        event.preventDefault();
        event.stopPropagation();
        setPaletteMode("import");
        setPaletteInitialQuery(null);
        setPaletteOpen((previous) => !previous || paletteMode !== "import");
        return;
      }
      if (command === "settings.usage") {
        event.preventDefault();
        event.stopPropagation();
        openUsageSettings();
        return;
      }
      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex !== null) {
        event.preventDefault();
        event.stopPropagation();
        const targetThreadId = threadJumpThreadIds[jumpIndex];
        if (targetThreadId) activateThread(targetThreadId);
        return;
      }
      if (command !== "chat.visible.next" && command !== "chat.visible.previous") return;
      event.preventDefault();
      event.stopPropagation();
      const nextThreadId = getNextVisibleSidebarThreadId({
        visibleThreadIds,
        activeThreadId: activeThreadId ?? undefined,
        direction: command === "chat.visible.previous" ? "backward" : "forward",
      });
      if (nextThreadId && nextThreadId !== activeThreadId) activateThread(nextThreadId);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (shouldIgnoreThreadJumpHintUpdate(event)) return;
      updateThreadJumpHints(event);
    };
    const onWindowBlur = () => clearThreadJumpHints();
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [
    activateThread,
    activeThreadId,
    getShortcutContext,
    homeDir,
    keybindings,
    openUsageSettings,
    paletteMode,
    threadJumpCommandByThreadId,
    threadJumpThreadIds,
    visibleThreadIds,
  ]);

  const platform = navigator.platform;
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.new") ??
    shortcutLabelForCommand(keybindings, "chat.newLatestProject");
  const newChatShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.newChat") ??
    shortcutLabelForCommand(keybindings, "chat.newLocal");
  const newTerminalThreadShortcutLabel = shortcutLabelForCommand(keybindings, "chat.newTerminal");
  const searchShortcutLabel =
    shortcutLabelForCommand(keybindings, "sidebar.search") ??
    (isMacPlatform(platform) ? "⌘K" : "Ctrl+K");
  const importThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "sidebar.importThread") ??
    (isMacPlatform(platform) ? "⌘I" : "Ctrl+I");
  const addProjectShortcutLabel =
    shortcutLabelForCommand(keybindings, "sidebar.addProject") ??
    (isMacPlatform(platform) ? "⇧⌘O" : "Ctrl+Shift+O");
  const usageSettingsShortcutLabel = shortcutLabelForCommand(keybindings, "settings.usage");
  const paletteProjects = useMemo<SidebarSearchProject[]>(
    () =>
      projects.map((project) => ({
        id: project.id,
        name: project.name,
        remoteName: project.remoteName,
        folderName: project.folderName,
        localName: project.localName,
        cwd: project.cwd,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      })),
    [projects],
  );
  const paletteActions = useMemo<SidebarSearchAction[]>(
    () => [
      {
        id: "new-chat",
        label: "New chat",
        description: "Open the new chat landing screen.",
        keywords: ["chat", "new", "home"],
        shortcutLabel: newChatShortcutLabel,
      },
      {
        id: "new-thread",
        label: "New thread",
        description: "Start a fresh thread in the current project.",
        keywords: ["thread", "new", "project"],
        shortcutLabel: newThreadShortcutLabel,
      },
      {
        id: "add-project",
        label: "Add project",
        description: "Open a repository or folder in the sidebar.",
        keywords: ["folder", "repo", "repository", "open"],
        shortcutLabel: addProjectShortcutLabel,
      },
      {
        id: "import-thread",
        label: "Import thread from...",
        description: "Attach a local thread to an existing provider session.",
        keywords: [
          "import",
          "resume",
          "thread",
          "session",
          "codex",
          "claude",
          "cursor",
          "opencode",
        ],
        shortcutLabel: importThreadShortcutLabel,
      },
      {
        id: "settings",
        label: "Settings",
        description: "Open app settings.",
        keywords: ["preferences", "config"],
      },
      {
        id: "usage-settings",
        label: "Usage settings",
        description: "Open provider usage and remaining credits.",
        keywords: ["usage", "limits", "credits", "quota", "providers"],
        shortcutLabel: usageSettingsShortcutLabel,
      },
    ],
    [
      addProjectShortcutLabel,
      importThreadShortcutLabel,
      newChatShortcutLabel,
      newThreadShortcutLabel,
      usageSettingsShortcutLabel,
    ],
  );

  const openSearch = useCallback(() => setPaletteOpen(true), []);
  const onPaletteOpenChange = useCallback((open: boolean) => {
    setPaletteOpen(open);
    if (open) return;
    setPaletteMode("search");
    setPaletteInitialQuery(null);
  }, []);

  return {
    paletteOpen,
    paletteMode,
    paletteInitialQuery,
    paletteProjects,
    paletteActions,
    setPaletteMode,
    onPaletteOpenChange,
    openSearch,
    visibleThreadJumpLabelByThreadId,
    visibleThreadJumpLabelPartsByThreadId,
    newThreadShortcutLabel,
    newChatShortcutLabel,
    newTerminalThreadShortcutLabel,
    searchShortcutLabel,
  };
}
