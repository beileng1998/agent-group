// FILE: EditorWorkspaceView.tsx
// Purpose: Read-only editor-style thread surface with file explorer, workspace
//          file search, file/diff preview, and chat.
// Layer: Chat route presentation

import { EditorWorkspaceChatPane } from "./editor-workspace/EditorWorkspaceChatPane";
import { EditorWorkspaceHeader } from "./editor-workspace/EditorWorkspaceHeader";
import {
  EditorActivityBar,
  EditorWorkspaceSidebar,
} from "./editor-workspace/EditorWorkspaceNavigation";
import { EditorWorkspaceSurface } from "./editor-workspace/EditorWorkspaceSurface";
import type { EditorWorkspaceViewProps } from "./editor-workspace/editorWorkspaceTypes";
import { useEditorWorkspaceController } from "./editor-workspace/useEditorWorkspaceController";

export type { EditorWorkspaceViewProps } from "./editor-workspace/editorWorkspaceTypes";

export function EditorWorkspaceView(props: EditorWorkspaceViewProps) {
  const controller = useEditorWorkspaceController({
    centerMode: props.centerMode,
    onCenterModeChange: props.onCenterModeChange,
  });

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-background-root)] text-foreground">
      <EditorWorkspaceHeader
        projectName={props.projectName}
        workspaceRoot={props.workspaceRoot}
        currentProjectId={props.currentProjectId ?? null}
        projectOptions={props.projectOptions ?? []}
        chatPaneVisible={controller.chatPaneVisible}
        onSelectProject={props.onSelectProject}
        onToggleChatPane={controller.toggleChatPaneVisible}
        onExitEditorView={props.onExitEditorView}
      />
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <EditorActivityBar
          centerMode={props.centerMode}
          searchActive={controller.searchPaneActive}
          sidebarVisible={controller.sidebarVisible}
          onSelectItem={controller.selectActivityBarItem}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <EditorWorkspaceSidebar
            visible={controller.sidebarVisible}
            searchActive={controller.searchPaneActive}
            searchQuery={controller.searchQuery}
            onSearchQueryChange={controller.setSearchQuery}
            workspaceRoot={props.workspaceRoot}
            selectedFilePath={props.selectedFilePath}
            expandedDirectories={props.expandedDirectories}
            centerMode={props.centerMode}
            diffFiles={props.diffFiles}
            diffFilesLoading={props.diffFilesLoading ?? false}
            selectedDiffFilePath={props.selectedDiffFilePath}
            diffOptionsControl={props.diffOptionsControl}
            onSelectFile={props.onSelectFile}
            onSelectDiffFile={props.onSelectDiffFile}
            onToggleDirectory={props.onToggleDirectory}
            onReferenceInChat={props.onReferenceInChat}
            onAskWhyInChat={props.onAskWhyInChat}
          />
          <EditorWorkspaceSurface
            centerMode={props.centerMode}
            workspaceRoot={props.workspaceRoot}
            selectedFilePath={props.selectedFilePath}
            diffPanel={props.diffPanel}
            onReferenceInChat={props.onReferenceInChat}
            onAskWhyInChat={props.onAskWhyInChat}
            onCommentInChat={props.onCommentInChat}
          />
          <EditorWorkspaceChatPane
            visible={controller.chatPaneVisible}
            width={controller.chatPaneWidth}
            onResizePointerDown={controller.handleChatPaneResizePointerDown}
            onResizeDoubleClick={controller.handleChatPaneResizeDoubleClick}
            onResizeKeyDown={controller.handleChatPaneResizeKeyDown}
          >
            {props.chatPanel}
          </EditorWorkspaceChatPane>
        </div>
      </div>
    </div>
  );
}

export default EditorWorkspaceView;
