import type {
  AutomationArchiveRunInput,
  AutomationCancelRunInput,
  AutomationCancelRunResult,
  AutomationCreateInput,
  AutomationDefinition,
  AutomationDeleteInput,
  AutomationListInput,
  AutomationListResult,
  AutomationMarkRunReadInput,
  AutomationRunActionResult,
  AutomationRunNowInput,
  AutomationRunNowResult,
  AutomationStreamEvent,
  AutomationUpdateInput,
} from "../automation";
import type { HighlightsListInput, HighlightsListOutput } from "../highlights";
import type {
  ClientOrchestrationCommand,
  OrchestrationEvent,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationImportThreadInput,
  OrchestrationImportThreadResult,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamItem,
  OrchestrationSubscribeThreadInput,
  OrchestrationThreadStreamItem,
} from "../orchestration";

export interface NativeApiOrchestrationDomains {
  orchestration: {
    getSnapshot: () => Promise<OrchestrationReadModel>;
    getShellSnapshot: () => Promise<OrchestrationShellSnapshot>;
    listHighlights: (input: HighlightsListInput) => Promise<HighlightsListOutput>;
    dispatchCommand: (command: ClientOrchestrationCommand) => Promise<{ sequence: number }>;
    importThread: (
      input: OrchestrationImportThreadInput,
    ) => Promise<OrchestrationImportThreadResult>;
    repairState: () => Promise<OrchestrationReadModel>;
    getTurnDiff: (input: OrchestrationGetTurnDiffInput) => Promise<OrchestrationGetTurnDiffResult>;
    getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput,
    ) => Promise<OrchestrationGetFullThreadDiffResult>;
    replayEvents: (fromSequenceExclusive: number) => Promise<OrchestrationEvent[]>;
    subscribeShell: () => Promise<void>;
    unsubscribeShell: () => Promise<void>;
    subscribeThread: (input: OrchestrationSubscribeThreadInput) => Promise<void>;
    unsubscribeThread: (input: OrchestrationSubscribeThreadInput) => Promise<void>;
    onShellEvent: (callback: (event: OrchestrationShellStreamItem) => void) => () => void;
    onThreadEvent: (callback: (event: OrchestrationThreadStreamItem) => void) => () => void;
  };
  automation: {
    list: (input?: AutomationListInput) => Promise<AutomationListResult>;
    create: (input: AutomationCreateInput) => Promise<AutomationDefinition>;
    update: (input: AutomationUpdateInput) => Promise<AutomationDefinition>;
    delete: (input: AutomationDeleteInput) => Promise<void>;
    runNow: (input: AutomationRunNowInput) => Promise<AutomationRunNowResult>;
    cancelRun: (input: AutomationCancelRunInput) => Promise<AutomationCancelRunResult>;
    markRunRead: (input: AutomationMarkRunReadInput) => Promise<AutomationRunActionResult>;
    archiveRun: (input: AutomationArchiveRunInput) => Promise<AutomationRunActionResult>;
    onEvent: (callback: (event: AutomationStreamEvent) => void) => () => void;
  };
}
