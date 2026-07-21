import { joinWorkspaceRelativePath } from "@agent-group/shared/path";

import { basenameOfPath } from "~/file-icons";
import { formatFileCommentRange } from "~/lib/fileComments";
import { PlusIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import { FileLineCommentBox } from "../chat/FileLineCommentBox";
import { PanelStateMessage } from "../chat/PanelStateMessage";
import { TranscriptSelectionAction } from "../chat/TranscriptSelectionAction";
import { WorkspaceFilePreviewHeader } from "../chat/WorkspaceFilePreviewHeader";
import { LocalImagePreview } from "../LocalImagePreview";
import { PdfFilePreview } from "../PdfFilePreview";
import {
  WorkspaceFilePreviewLoadingState,
  WorkspaceFileTextContents,
} from "./WorkspaceFileTextContents";
import { markdownPreviewCwd, type WorkspaceFilePreviewProps } from "./workspaceFilePreviewModel";
import type { WorkspaceFilePreviewController } from "./useWorkspaceFilePreviewController";

export function WorkspaceFilePreviewSurface(props: {
  input: WorkspaceFilePreviewProps;
  controller: WorkspaceFilePreviewController;
}) {
  const { input, controller } = props;
  const { filePath, workspaceRoot } = input;
  const { kind } = controller;

  if (!workspaceRoot && !kind.isLocalAbsolute && !kind.isScratchBinaryPreview) {
    return (
      <PanelStateMessage density="compact" fill="flex">
        <p>No workspace is attached to this chat.</p>
      </PanelStateMessage>
    );
  }

  if (!filePath) {
    return (
      input.emptyState ?? (
        <PanelStateMessage density="compact" fill="flex">
          <p>Select a file from the explorer.</p>
        </PanelStateMessage>
      )
    );
  }

  if (kind.needsLocalPreviewGrant && !controller.localPreviewGrant) {
    if (controller.localPreviewGrantQuery.error) {
      return (
        <PanelStateMessage density="compact" fill="flex" className="items-start justify-start p-3">
          <p className="text-left text-[11px] text-destructive/85">
            {controller.localPreviewGrantQuery.error instanceof Error
              ? controller.localPreviewGrantQuery.error.message
              : "Could not create local file preview grant."}
          </p>
        </PanelStateMessage>
      );
    }
    return <WorkspaceFilePreviewLoadingState />;
  }

  // PDFs own their full surface, including toolbar and navigation.
  if (kind.isPdf) {
    const openInTarget =
      workspaceRoot && kind.isWorkspaceRelative
        ? joinWorkspaceRelativePath(workspaceRoot, filePath)
        : filePath;
    return (
      <PdfFilePreview
        filePath={filePath}
        cwd={workspaceRoot}
        previewGrant={controller.localPreviewGrant}
        openInTarget={openInTarget}
      />
    );
  }

  const hoveredCommentLine = controller.lineCommenting.hoveredLine;
  const activeCommentLine = controller.lineCommenting.activeLine;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-background-surface)]">
      <WorkspaceFilePreviewHeader
        workspaceRoot={workspaceRoot}
        filePath={filePath}
        isMarkdown={kind.isMarkdown}
        markdownPreviewEnabled={controller.showMarkdownPreview}
        onMarkdownPreviewChange={controller.handleMarkdownPreviewChange}
        onReferenceInChat={input.onReferenceInChat}
        onAskWhyInChat={input.onAskWhyInChat}
        truncated={controller.fileQuery.data?.truncated ?? false}
      />
      {kind.isImage ? (
        <div
          className="editor-file-viewer min-h-0 flex-1 overflow-auto"
          onContextMenu={controller.handleContentsContextMenu}
        >
          <LocalImagePreview
            src={filePath}
            cwd={workspaceRoot}
            previewGrant={controller.localPreviewGrant}
            alt={basenameOfPath(filePath)}
            className="min-h-full"
            imageClassName="max-h-[calc(100vh-13rem)]"
          />
        </div>
      ) : controller.fileQuery.isLoading ? (
        <WorkspaceFilePreviewLoadingState />
      ) : controller.fileQuery.error ? (
        <PanelStateMessage density="compact" fill="flex" className="items-start justify-start p-3">
          <p className="text-left text-[11px] text-destructive/85">
            {controller.fileQuery.error instanceof Error
              ? controller.fileQuery.error.message
              : "Could not read file."}
          </p>
        </PanelStateMessage>
      ) : (
        <div
          ref={controller.contentsRef}
          className={cn(
            "editor-file-viewer min-h-0 flex-1 overflow-auto",
            controller.showMarkdownPreview && "editor-file-viewer--markdown-preview",
          )}
          onContextMenu={controller.handleContentsContextMenu}
          onMouseUp={controller.previewSelectionAction.onContainerMouseUp}
          onMouseMove={controller.lineCommenting.onContainerMouseMove}
          onMouseLeave={controller.lineCommenting.onContainerMouseLeave}
        >
          {controller.showMarkdownPreview ? (
            <div className="editor-markdown-preview">
              <ChatMarkdown
                text={controller.fileContents}
                cwd={markdownPreviewCwd(workspaceRoot, filePath)}
                isStreaming={false}
                className="editor-markdown-preview__body text-sm leading-relaxed"
                {...(controller.canToggleTasks
                  ? { onTaskToggle: controller.handleTaskToggle }
                  : {})}
              />
            </div>
          ) : (
            <WorkspaceFileTextContents
              path={filePath}
              contents={controller.fileContents}
              themeName={controller.diffThemeName}
            />
          )}
          {!controller.showMarkdownPreview && controller.lineCount > 0 ? (
            <span className="sr-only">{controller.lineCount} lines</span>
          ) : null}
          {controller.previewSelectionAction.pendingAction ? (
            <TranscriptSelectionAction
              left={controller.previewSelectionAction.pendingAction.left}
              top={controller.previewSelectionAction.pendingAction.top}
              placement={controller.previewSelectionAction.pendingAction.placement}
              onAddToChat={controller.previewSelectionAction.commit}
            />
          ) : null}
          {controller.lineCommentingEnabled && hoveredCommentLine && !activeCommentLine ? (
            <button
              type="button"
              className="editor-file-viewer__comment-add"
              style={{
                top: hoveredCommentLine.top,
                left: hoveredCommentLine.left,
                height: hoveredCommentLine.height,
              }}
              aria-label={`Comment on line ${hoveredCommentLine.lineNumber}`}
              title="Comment"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                controller.lineCommenting.openComment(hoveredCommentLine);
              }}
            >
              <span className="editor-file-viewer__comment-add-glyph">
                <PlusIcon className="size-3.5" />
              </span>
            </button>
          ) : null}
          {controller.lineCommentingEnabled && activeCommentLine ? (
            <>
              <div
                className="editor-file-viewer__comment-line-highlight"
                style={{ top: activeCommentLine.top, height: activeCommentLine.height }}
                aria-hidden="true"
              />
              <FileLineCommentBox
                lineLabel={formatFileCommentRange({
                  startLine: activeCommentLine.lineNumber,
                  endLine: activeCommentLine.lineNumber,
                })}
                top={activeCommentLine.top + activeCommentLine.height}
                left={activeCommentLine.left}
                width={Math.max(
                  240,
                  Math.min(440, activeCommentLine.containerWidth - activeCommentLine.left - 16),
                )}
                onCancel={controller.lineCommenting.closeComment}
                onSubmit={(text) => {
                  controller.commitLineComment({
                    startLine: activeCommentLine.lineNumber,
                    endLine: activeCommentLine.lineNumber,
                    text,
                  });
                  controller.lineCommenting.closeComment();
                }}
              />
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
