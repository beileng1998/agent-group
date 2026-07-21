import type { FileDiffMetadata } from "@pierre/diffs/react";
import type { ProjectId } from "@agent-group/contracts";
import type { ReactNode } from "react";

import type { ChatFileReference } from "~/lib/chatReferences";
import type { FileCommentSelection } from "~/lib/fileComments";

import type { ProjectMenuPickerOption } from "../ProjectMenuPicker";

export type EditorCenterMode = "file" | "diff";
export type EditorActivityBarItem = EditorCenterMode | "search";

export interface EditorWorkspaceViewProps {
  workspaceRoot: string | null;
  projectName: string | null;
  currentProjectId?: ProjectId | null;
  projectOptions?: ReadonlyArray<ProjectMenuPickerOption>;
  selectedFilePath: string | null;
  expandedDirectories: ReadonlySet<string>;
  centerMode: EditorCenterMode;
  diffFiles: ReadonlyArray<FileDiffMetadata>;
  diffFilesLoading?: boolean;
  selectedDiffFilePath: string | null;
  diffOptionsControl?: ReactNode;
  diffPanel: ReactNode;
  chatPanel: ReactNode;
  onSelectFile: (path: string) => void;
  onSelectDiffFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  onCenterModeChange: (mode: EditorCenterMode) => void;
  onExitEditorView: () => void;
  onReferenceInChat?: (reference: ChatFileReference) => void;
  onAskWhyInChat?: (reference: ChatFileReference) => void;
  onCommentInChat?: (comment: FileCommentSelection) => void;
  onSelectProject?: (projectId: ProjectId) => void;
}
