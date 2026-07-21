import type { ReactNode } from "react";

import type { ChatFileReference } from "~/lib/chatReferences";
import type { FileCommentSelection } from "~/lib/fileComments";
import { cn } from "~/lib/utils";

import { WorkspaceFilePreview } from "../WorkspaceFilePreview";
import type { EditorCenterMode } from "./editorWorkspaceTypes";

export function EditorWorkspaceSurface(props: {
  centerMode: EditorCenterMode;
  workspaceRoot: string | null;
  selectedFilePath: string | null;
  diffPanel: ReactNode;
  onReferenceInChat: ((reference: ChatFileReference) => void) | undefined;
  onAskWhyInChat: ((reference: ChatFileReference) => void) | undefined;
  onCommentInChat: ((comment: FileCommentSelection) => void) | undefined;
}) {
  return (
    <main className="flex min-h-[16rem] min-w-0 flex-1 border-b border-border/65 lg:h-full lg:border-b-0">
      {/* Keep the diff panel mounted while browsing files: unmounting it drops
          its parsed patch, worker pool, and query subscriptions. */}
      <div className={cn("min-h-0 min-w-0 flex-1", props.centerMode !== "diff" && "hidden")}>
        {props.diffPanel}
      </div>
      {props.centerMode === "file" ? (
        <div className="flex min-h-0 min-w-0 flex-1">
          <WorkspaceFilePreview
            workspaceRoot={props.workspaceRoot}
            filePath={props.selectedFilePath}
            onReferenceInChat={props.onReferenceInChat}
            onAskWhyInChat={props.onAskWhyInChat}
            onCommentInChat={props.onCommentInChat}
          />
        </div>
      ) : null}
    </main>
  );
}
