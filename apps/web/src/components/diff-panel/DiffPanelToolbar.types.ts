// FILE: DiffPanelToolbar.types.ts
// Purpose: Defines the toolbar's diff-source, view, and action contract.
// Layer: Web diff panel UI contract

import type { FileDiffMetadata } from "@pierre/diffs/react";
import type { ThreadId, TurnId } from "@agent-group/contracts";
import type { TimestampFormat } from "~/appSettings";
import type { RepoDiffScope } from "~/repoDiffScopeStore";
import type { TurnDiffSummary } from "~/types";
import type { DiffPanelTurnScopeIntent, DiffPanelViewSource } from "../DiffPanel.logic";
import type { DiffRenderMode } from "../chat/chatHeaderControls";

export interface DiffPanelToolbarProps {
  activeCwd: string | null;
  activeThreadId: ThreadId | null;
  viewSource: DiffPanelViewSource;
  turnScopeIntent: DiffPanelTurnScopeIntent;
  scopeFileCounts: Partial<Record<RepoDiffScope, number>>;
  activeStats: { additions: number; deletions: number } | null;
  orderedTurnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  inferredCheckpointTurnCountByTurnId: Record<string, number>;
  selectedTurnId: TurnId | null;
  timestampFormat: TimestampFormat;
  renderableFiles: ReadonlyArray<FileDiffMetadata>;
  selectedFilePath: string | null;
  fileTreeOpen: boolean;
  resolvedTheme: "light" | "dark";
  diffRenderMode: DiffRenderMode;
  diffWordWrap: boolean;
  diffIgnoreWhitespace: boolean;
  diffCopyText: string | null;
  isDiffCopied: boolean;
  allFilesCollapsed: boolean;
  onSelectRepoScope: (scope: RepoDiffScope) => void;
  onSelectAllTurns: () => void;
  onSelectLastTurn: () => void;
  onSelectTurn: (turnId: TurnId | null) => void;
  onSelectFile: (filePath: string) => void;
  onToggleFileTree: () => void;
  onDiffRenderModeChange: (mode: DiffRenderMode) => void;
  onDiffWordWrapChange: (enabled: boolean) => void;
  onDiffIgnoreWhitespaceChange: (enabled: boolean) => void;
  onCopyDiff: () => void;
  onToggleCollapseAll: () => void;
  scopePickerOpen?: boolean;
  onScopePickerOpenChange?: (open: boolean) => void;
  onClosePanel?: () => void;
}
