// FILE: WorkspaceFilePreview.tsx
// Purpose: Shared single-file preview composition root.
// Layer: Web chat presentation component
// Exports: WorkspaceFilePreview, WorkspaceFilePreviewProps,
//          isMarkdownPreviewablePath

import { WorkspaceFilePreviewSurface } from "./workspace-preview/WorkspaceFilePreviewSurface";
import type { WorkspaceFilePreviewProps } from "./workspace-preview/workspaceFilePreviewModel";
import { useWorkspaceFilePreviewController } from "./workspace-preview/useWorkspaceFilePreviewController";

export type { WorkspaceFilePreviewProps } from "./workspace-preview/workspaceFilePreviewModel";
export { isMarkdownPreviewablePath } from "./workspace-preview/workspaceFilePreviewModel";

export function WorkspaceFilePreview(props: WorkspaceFilePreviewProps) {
  const controller = useWorkspaceFilePreviewController(props);
  return <WorkspaceFilePreviewSurface input={props} controller={controller} />;
}
