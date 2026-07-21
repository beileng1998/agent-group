import { type ThreadId } from "@agent-group/contracts";
import { type TerminalCliKind } from "@agent-group/shared/terminalThreads";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Plus, SquareSplitHorizontal, SquareSplitVertical, Trash2 } from "~/lib/icons";
import {
  MAX_TERMINALS_PER_GROUP,
  type ThreadTerminalGroup,
  type ThreadTerminalPresentationMode,
} from "../../types";
import { type TerminalChromeActionItem } from "../terminal/TerminalChrome";
import { resolveThreadTerminalLayout } from "../terminal/TerminalLayout";
import {
  buildTerminalRuntimeKey,
  terminalRuntimeRegistry,
} from "../terminal/terminalRuntimeRegistry";

interface UseThreadTerminalDrawerModelInput {
  threadId: ThreadId;
  presentationMode: ThreadTerminalPresentationMode;
  terminalIds: string[];
  terminalLabelsById: Record<string, string>;
  terminalTitleOverridesById: Record<string, string>;
  terminalCliKindsById: Record<string, TerminalCliKind>;
  terminalAttentionStatesById: Record<string, "attention" | "review">;
  runningTerminalIds: string[];
  activeTerminalId: string;
  terminalGroups: ThreadTerminalGroup[];
  activeTerminalGroupId: string;
  splitShortcutLabel?: string | undefined;
  splitDownShortcutLabel?: string | undefined;
  newShortcutLabel?: string | undefined;
  closeShortcutLabel?: string | undefined;
  workspaceCloseShortcutLabel?: string | undefined;
  onSplitTerminal: () => void;
  onSplitTerminalDown: () => void;
  onNewTerminal: () => void;
  onCloseTerminal: (terminalId: string) => void;
}

export function useThreadTerminalDrawerModel({
  threadId,
  presentationMode,
  terminalIds,
  terminalLabelsById,
  terminalTitleOverridesById,
  terminalCliKindsById,
  terminalAttentionStatesById,
  runningTerminalIds,
  activeTerminalId,
  terminalGroups,
  activeTerminalGroupId,
  splitShortcutLabel,
  splitDownShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
  workspaceCloseShortcutLabel,
  onSplitTerminal,
  onSplitTerminalDown,
  onNewTerminal,
  onCloseTerminal,
}: UseThreadTerminalDrawerModelInput) {
  const isWorkspaceMode = presentationMode === "workspace";
  const previousRuntimeKeysRef = useRef<Set<string>>(new Set());
  const layout = useMemo(
    () =>
      resolveThreadTerminalLayout({
        activeTerminalGroupId,
        activeTerminalId,
        runningTerminalIds,
        terminalAttentionStatesById,
        terminalCliKindsById,
        terminalGroups,
        terminalIds,
        terminalLabelsById,
        terminalTitleOverridesById,
      }),
    [
      activeTerminalGroupId,
      activeTerminalId,
      runningTerminalIds,
      terminalAttentionStatesById,
      terminalCliKindsById,
      terminalGroups,
      terminalIds,
      terminalLabelsById,
      terminalTitleOverridesById,
    ],
  );

  useEffect(() => {
    const nextRuntimeKeySet = new Set(
      layout.normalizedTerminalIds.map((terminalId) =>
        buildTerminalRuntimeKey(threadId, terminalId),
      ),
    );
    for (const previousRuntimeKey of previousRuntimeKeysRef.current) {
      if (nextRuntimeKeySet.has(previousRuntimeKey)) {
        continue;
      }
      terminalRuntimeRegistry.dispose(previousRuntimeKey);
    }
    previousRuntimeKeysRef.current = nextRuntimeKeySet;
  }, [layout.normalizedTerminalIds, threadId]);

  const splitTerminalActionLabel = layout.hasReachedSplitLimit
    ? `Split Terminal (max ${MAX_TERMINALS_PER_GROUP} per group)`
    : splitShortcutLabel
      ? `Split Right (${splitShortcutLabel})`
      : "Split Right";
  const splitTerminalDownActionLabel = layout.hasReachedSplitLimit
    ? `Split Down (max ${MAX_TERMINALS_PER_GROUP} per group)`
    : splitDownShortcutLabel
      ? `Split Down (${splitDownShortcutLabel})`
      : "Split Down";
  const newTerminalActionLabel = newShortcutLabel
    ? `New Terminal (${newShortcutLabel})`
    : "New Terminal";
  const resolvedCloseShortcutLabel = isWorkspaceMode
    ? (workspaceCloseShortcutLabel ?? closeShortcutLabel)
    : closeShortcutLabel;
  const closeTerminalActionLabel = resolvedCloseShortcutLabel
    ? `Close Terminal (${resolvedCloseShortcutLabel})`
    : "Close Terminal";
  const onSplitTerminalAction = useCallback(() => {
    if (layout.hasReachedSplitLimit) return;
    onSplitTerminal();
  }, [layout.hasReachedSplitLimit, onSplitTerminal]);
  const onSplitTerminalDownAction = useCallback(() => {
    if (layout.hasReachedSplitLimit) return;
    onSplitTerminalDown();
  }, [layout.hasReachedSplitLimit, onSplitTerminalDown]);
  const onNewTerminalAction = useCallback(() => {
    onNewTerminal();
  }, [onNewTerminal]);

  const terminalChromeActions: TerminalChromeActionItem[] = [
    {
      label: splitTerminalActionLabel,
      onClick: onSplitTerminalAction,
      disabled: layout.hasReachedSplitLimit,
      children: <SquareSplitHorizontal className="size-3.25" />,
    },
    {
      label: splitTerminalDownActionLabel,
      onClick: onSplitTerminalDownAction,
      disabled: layout.hasReachedSplitLimit,
      children: <SquareSplitVertical className="size-3.25" />,
    },
    {
      label: newTerminalActionLabel,
      onClick: onNewTerminalAction,
      children: <Plus className="size-3.25" />,
    },
    {
      label: closeTerminalActionLabel,
      onClick: () => onCloseTerminal(layout.resolvedActiveTerminalId),
      children: <Trash2 className="size-3.25" />,
    },
  ];

  return {
    ...layout,
    isWorkspaceMode,
    resolvedCloseShortcutLabel,
    showTerminalGroupTabs: layout.resolvedTerminalGroups.length > 1,
    terminalChromeActions,
  };
}
