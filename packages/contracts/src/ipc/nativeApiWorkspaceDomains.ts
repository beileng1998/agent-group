import type {
  AgentGroupConfig,
  AgentGroupGetConfigInput,
  AgentGroupGetOverviewInput,
  AgentGroupGetSessionInput,
  AgentGroupOverview,
  AgentGroupSessionDocument,
  AgentGroupUpdateConfigInput,
  AgentGroupUpdateSessionInput,
  AgentGroupWriteContextInput,
} from "../agentGroup";
import type { EditorId } from "../editor";
import type { FilesystemBrowseInput, FilesystemBrowseResult } from "../filesystem";
import type {
  ProjectCreateLocalFilePreviewGrantInput,
  ProjectCreateLocalFilePreviewGrantResult,
  ProjectDevServerEvent,
  ProjectDiscoverScriptsInput,
  ProjectDiscoverScriptsResult,
  ProjectListDevServersResult,
  ProjectListDirectoriesInput,
  ProjectListDirectoriesResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectRunDevServerInput,
  ProjectRunDevServerResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectSearchLocalEntriesInput,
  ProjectSearchLocalEntriesResult,
  ProjectStopDevServerInput,
  ProjectStopDevServerResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "../project";
import type { StudioListThreadOutputsInput, StudioListThreadOutputsResult } from "../studio";
import type {
  TerminalAckOutputInput,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "../terminal";
import type {
  BrowserAttachWebviewInput,
  BrowserCaptureScreenshotResult,
  BrowserCopyLinkEvent,
  BrowserDetachWebviewInput,
  BrowserExecuteCdpInput,
  BrowserNavigateInput,
  BrowserNewTabInput,
  BrowserOpenInput,
  BrowserSetPanelBoundsInput,
  BrowserTabInput,
  BrowserThreadInput,
  ContextMenuItem,
  ThreadBrowserState,
} from "./desktop";

export interface NativeApiWorkspaceDomains {
  dialogs: {
    pickFolder: () => Promise<string | null>;
    saveFile?: (input: {
      defaultFilename: string;
      contents: string;
      filters?: ReadonlyArray<{ name: string; extensions: ReadonlyArray<string> }>;
    }) => Promise<string | null>;
    confirm: (message: string) => Promise<boolean>;
  };
  terminal: {
    open: (input: TerminalOpenInput) => Promise<TerminalSessionSnapshot>;
    write: (input: TerminalWriteInput) => Promise<void>;
    ackOutput: (input: TerminalAckOutputInput) => Promise<void>;
    resize: (input: TerminalResizeInput) => Promise<void>;
    clear: (input: TerminalClearInput) => Promise<void>;
    restart: (input: TerminalRestartInput) => Promise<TerminalSessionSnapshot>;
    close: (input: TerminalCloseInput) => Promise<void>;
    onEvent: (callback: (event: TerminalEvent) => void) => () => void;
  };
  projects: {
    discoverScripts: (input: ProjectDiscoverScriptsInput) => Promise<ProjectDiscoverScriptsResult>;
    listDirectories: (input: ProjectListDirectoriesInput) => Promise<ProjectListDirectoriesResult>;
    searchEntries: (input: ProjectSearchEntriesInput) => Promise<ProjectSearchEntriesResult>;
    searchLocalEntries: (
      input: ProjectSearchLocalEntriesInput,
    ) => Promise<ProjectSearchLocalEntriesResult>;
    readFile: (input: ProjectReadFileInput) => Promise<ProjectReadFileResult>;
    createLocalFilePreviewGrant: (
      input: ProjectCreateLocalFilePreviewGrantInput,
    ) => Promise<ProjectCreateLocalFilePreviewGrantResult>;
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>;
    runDevServer: (input: ProjectRunDevServerInput) => Promise<ProjectRunDevServerResult>;
    stopDevServer: (input: ProjectStopDevServerInput) => Promise<ProjectStopDevServerResult>;
    listDevServers: () => Promise<ProjectListDevServersResult>;
    onDevServerEvent: (callback: (event: ProjectDevServerEvent) => void) => () => void;
  };
  agentGroup: {
    getConfig: (input: AgentGroupGetConfigInput) => Promise<AgentGroupConfig>;
    getOverview: (input: AgentGroupGetOverviewInput) => Promise<AgentGroupOverview>;
    getSession: (input: AgentGroupGetSessionInput) => Promise<AgentGroupSessionDocument>;
    writeContext: (input: AgentGroupWriteContextInput) => Promise<AgentGroupSessionDocument>;
    updateConfig: (input: AgentGroupUpdateConfigInput) => Promise<AgentGroupConfig>;
    updateSession: (input: AgentGroupUpdateSessionInput) => Promise<AgentGroupSessionDocument>;
  };
  filesystem: {
    browse: (input: FilesystemBrowseInput) => Promise<FilesystemBrowseResult>;
  };
  studio: {
    listThreadOutputs: (
      input: StudioListThreadOutputsInput,
    ) => Promise<StudioListThreadOutputsResult>;
  };
  shell: {
    openInEditor: (cwd: string, editor: EditorId) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
    showInFolder: (path: string) => Promise<void>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
  };
  browser: {
    open: (input: BrowserOpenInput) => Promise<ThreadBrowserState>;
    close: (input: BrowserThreadInput) => Promise<ThreadBrowserState>;
    hide: (input: BrowserThreadInput) => Promise<void>;
    getState: (input: BrowserThreadInput) => Promise<ThreadBrowserState>;
    setPanelBounds: (input: BrowserSetPanelBoundsInput) => Promise<void>;
    attachWebview: (input: BrowserAttachWebviewInput) => Promise<ThreadBrowserState>;
    detachWebview: (input: BrowserDetachWebviewInput) => Promise<void>;
    copyLink: (input: BrowserTabInput) => Promise<void>;
    copyScreenshotToClipboard: (input: BrowserTabInput) => Promise<void>;
    captureScreenshot: (input: BrowserTabInput) => Promise<BrowserCaptureScreenshotResult>;
    executeCdp: (input: BrowserExecuteCdpInput) => Promise<unknown>;
    navigate: (input: BrowserNavigateInput) => Promise<ThreadBrowserState>;
    reload: (input: BrowserTabInput) => Promise<ThreadBrowserState>;
    goBack: (input: BrowserTabInput) => Promise<ThreadBrowserState>;
    goForward: (input: BrowserTabInput) => Promise<ThreadBrowserState>;
    newTab: (input: BrowserNewTabInput) => Promise<ThreadBrowserState>;
    closeTab: (input: BrowserTabInput) => Promise<ThreadBrowserState>;
    selectTab: (input: BrowserTabInput) => Promise<ThreadBrowserState>;
    openDevTools: (input: BrowserTabInput) => Promise<void>;
    onState: (callback: (state: ThreadBrowserState) => void) => () => void;
    onCopyLink: (callback: (event: BrowserCopyLinkEvent) => void) => () => void;
  };
}
