import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useTheme } from "~/hooks/useTheme";
import { getSelectionWithin, type ChatFileReference } from "~/lib/chatReferences";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import type { FileCommentSelection } from "~/lib/fileComments";
import { showFileReferenceContextMenu } from "~/lib/fileReferenceContextMenu";
import { toggleMarkdownTaskMarker } from "~/lib/markdownTaskList";
import {
  isLocalPreviewGrantUsable,
  projectLocalPreviewGrantQueryOptions,
  projectReadFileQueryOptions,
} from "~/lib/projectReactQuery";
import { readNativeApi } from "~/nativeApi";
import { useFileLineCommenting } from "../chat/useFileLineCommenting";
import { useCodeSelectionAction } from "../chat/useCodeSelectionAction";
import {
  classifyWorkspaceFilePreview,
  type WorkspaceFilePreviewProps,
} from "./workspaceFilePreviewModel";

export function useWorkspaceFilePreviewController(props: WorkspaceFilePreviewProps) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const contentsRef = useRef<HTMLDivElement>(null);
  const taskWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestTaskWriteVersionRef = useRef({ next: 0, byFile: new Map<string, number>() });
  const { filePath, onAskWhyInChat, onCommentInChat, onReferenceInChat, workspaceRoot } = props;
  const queryClient = useQueryClient();
  const markdownPreviewDefault = props.markdownPreviewDefault ?? false;
  const kind = classifyWorkspaceFilePreview(filePath);
  const [markdownPreviewEnabled, setMarkdownPreviewEnabled] = useState(markdownPreviewDefault);

  const localPreviewGrantQuery = useQuery(
    projectLocalPreviewGrantQueryOptions({
      path: filePath,
      enabled: kind.needsLocalPreviewGrant,
    }),
  );
  const localPreviewGrant =
    kind.needsLocalPreviewGrant && isLocalPreviewGrantUsable(localPreviewGrantQuery.data)
      ? (localPreviewGrantQuery.data?.grant ?? null)
      : null;
  const fileQuery = useQuery(
    projectReadFileQueryOptions({
      cwd: workspaceRoot,
      relativePath: filePath,
      previewGrant: localPreviewGrant,
      enabled:
        filePath !== null &&
        !kind.isImage &&
        !kind.isPdf &&
        (workspaceRoot !== null || localPreviewGrant !== null),
    }),
  );

  useEffect(() => {
    setMarkdownPreviewEnabled(markdownPreviewDefault);
  }, [filePath, markdownPreviewDefault]);

  const fileContents = fileQuery.data?.contents ?? "";
  const showMarkdownPreview = kind.isMarkdown && markdownPreviewEnabled;
  const lineCount = useMemo(
    () => (fileContents.length === 0 ? 0 : fileContents.split("\n").length),
    [fileContents],
  );

  const readPreviewSelection = useCallback(
    (container: HTMLElement): Omit<ChatFileReference, "path"> | null =>
      showMarkdownPreview ? null : getSelectionWithin(container),
    [showMarkdownPreview],
  );
  const commitPreviewSelection = useCallback(
    (selection: Omit<ChatFileReference, "path">) => {
      if (filePath) {
        onReferenceInChat?.({ path: filePath, ...selection });
      }
    },
    [onReferenceInChat, filePath],
  );
  const previewSelectionAction = useCodeSelectionAction({
    enabled: Boolean(onReferenceInChat && filePath) && !showMarkdownPreview,
    readSelection: readPreviewSelection,
    onCommit: commitPreviewSelection,
  });

  const lineCommentingEnabled = Boolean(onCommentInChat && filePath) && !showMarkdownPreview;
  const lineCommenting = useFileLineCommenting({
    enabled: lineCommentingEnabled,
    resetKey: filePath,
  });
  const commitLineComment = useCallback(
    (selection: Pick<FileCommentSelection, "startLine" | "endLine" | "text">) => {
      if (filePath) {
        onCommentInChat?.({ path: filePath, ...selection });
      }
    },
    [filePath, onCommentInChat],
  );

  const handleContentsContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!filePath) {
        return;
      }
      event.preventDefault();
      const container = contentsRef.current;
      const selection = container ? readPreviewSelection(container) : null;
      void showFileReferenceContextMenu({
        path: filePath,
        position: { x: event.clientX, y: event.clientY },
        selection,
        onReferenceInChat,
        onAskWhyInChat,
      });
    },
    [onAskWhyInChat, onReferenceInChat, filePath, readPreviewSelection],
  );

  const handleTaskToggle = useCallback(
    ({ sourceLine, checked }: { sourceLine: number; checked: boolean }) => {
      if (!workspaceRoot || !filePath) {
        return;
      }
      const options = projectReadFileQueryOptions({ cwd: workspaceRoot, relativePath: filePath });
      const current = queryClient.getQueryData(options.queryKey);
      if (!current || current.truncated) {
        return;
      }
      const nextContents = toggleMarkdownTaskMarker(current.contents, sourceLine, checked);
      if (nextContents === null) {
        return;
      }
      const api = readNativeApi();
      if (!api) {
        return;
      }
      queryClient.setQueryData(options.queryKey, { ...current, contents: nextContents });
      const writeRelativePath = current.relativePath;
      const fileKey = `${workspaceRoot}\0${filePath}`;
      const writeVersion = latestTaskWriteVersionRef.current.next + 1;
      latestTaskWriteVersionRef.current.next = writeVersion;
      latestTaskWriteVersionRef.current.byFile.set(fileKey, writeVersion);
      taskWriteQueueRef.current = taskWriteQueueRef.current
        .catch(() => undefined)
        .then(() =>
          api.projects.writeFile({
            cwd: workspaceRoot,
            relativePath: writeRelativePath,
            contents: nextContents,
          }),
        )
        .then(() => undefined)
        .catch(() => {
          if (latestTaskWriteVersionRef.current.byFile.get(fileKey) !== writeVersion) {
            return;
          }
          void queryClient.invalidateQueries({ queryKey: options.queryKey });
        });
      void taskWriteQueueRef.current;
    },
    [filePath, queryClient, workspaceRoot],
  );

  const handleMarkdownPreviewChange = useCallback((rendered: boolean) => {
    setMarkdownPreviewEnabled(rendered);
  }, []);
  const canToggleTasks =
    workspaceRoot !== null &&
    kind.isWorkspaceRelative &&
    fileQuery.data !== undefined &&
    !fileQuery.data.truncated;

  return {
    canToggleTasks,
    commitLineComment,
    contentsRef,
    diffThemeName,
    fileContents,
    fileQuery,
    handleContentsContextMenu,
    handleMarkdownPreviewChange,
    handleTaskToggle,
    kind,
    lineCommenting,
    lineCommentingEnabled,
    lineCount,
    localPreviewGrant,
    localPreviewGrantQuery,
    previewSelectionAction,
    showMarkdownPreview,
  };
}

export type WorkspaceFilePreviewController = ReturnType<typeof useWorkspaceFilePreviewController>;
