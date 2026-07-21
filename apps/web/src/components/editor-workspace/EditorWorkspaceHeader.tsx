import type { ProjectId } from "@agent-group/contracts";

import {
  useDesktopTopBarTrafficLightGutterClassName,
  useDesktopTopBarWindowControlsGutterClassName,
} from "~/hooks/useDesktopTopBarGutter";
import { ChatBubbleIcon, ChevronDownIcon, PanelRightCloseIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import {
  ChatHeaderButton,
  ChatHeaderIconButton,
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
} from "../chat/chatHeaderControls";
import { ProjectMenuPicker, type ProjectMenuPickerOption } from "../ProjectMenuPicker";

export function EditorWorkspaceHeader(props: {
  projectName: string | null;
  workspaceRoot: string | null;
  currentProjectId: ProjectId | null;
  projectOptions: ReadonlyArray<ProjectMenuPickerOption>;
  chatPaneVisible: boolean;
  onSelectProject: ((projectId: ProjectId) => void) | undefined;
  onToggleChatPane: () => void;
  onExitEditorView: () => void;
}) {
  const trafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();
  const desktopTopBarWindowControlsGutterClassName =
    useDesktopTopBarWindowControlsGutterClassName();

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 px-2 sm:px-3",
        CHAT_SURFACE_HEADER_HEIGHT_CLASS,
        CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
        desktopTopBarWindowControlsGutterClassName,
      )}
    >
      <div className={cn("flex min-w-0 flex-1 items-center gap-1.5", trafficLightGutterClassName)}>
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">
            {props.projectName ?? "Workspace"}
          </span>
          <span className="hidden truncate text-[11px] text-muted-foreground/70 sm:inline">
            {props.workspaceRoot ?? "No workspace"}
          </span>
        </div>
        {props.onSelectProject && props.projectOptions.length > 0 ? (
          <ProjectMenuPicker
            projectOptions={props.projectOptions}
            selectedProjectId={props.currentProjectId}
            onProjectIdChange={props.onSelectProject}
            trigger={
              <ChatHeaderIconButton
                type="button"
                tone="plain"
                label="Switch project"
                title="Switch project"
                className="size-6"
              >
                <ChevronDownIcon className="size-3.5" />
              </ChatHeaderIconButton>
            }
          />
        ) : null}
      </div>
      <ChatHeaderButton
        type="button"
        tone="outline"
        aria-pressed={props.chatPaneVisible}
        title={props.chatPaneVisible ? "Hide chat panel" : "Show chat panel"}
        className="gap-1.5"
        onClick={props.onToggleChatPane}
      >
        <PanelRightCloseIcon className="size-3.5" />
        <span className="sr-only">
          {props.chatPaneVisible ? "Hide chat panel" : "Show chat panel"}
        </span>
      </ChatHeaderButton>
      <ChatHeaderButton
        type="button"
        tone="outline"
        aria-pressed={true}
        title="Switch to chat view"
        className="w-[5.5rem] gap-1.5"
        onClick={props.onExitEditorView}
      >
        <ChatBubbleIcon className="size-3.5" />
        <span className="truncate font-normal">Chat</span>
      </ChatHeaderButton>
    </div>
  );
}
