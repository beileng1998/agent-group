import type {
  AutomationCompletionPolicy,
  AutomationMode,
  AutomationSchedule,
} from "@agent-group/contracts";

export interface ChatAutomationIntent {
  readonly name: string;
  readonly prompt: string;
  readonly schedule: AutomationSchedule;
  readonly cadenceLabel: string;
  readonly maxIterations: number | null;
  readonly completionPolicy: AutomationCompletionPolicy;
  readonly executionScope: ChatAutomationExecutionScope;
}

export type ChatAutomationExecutionScope = "thread" | "standalone" | "worktree";

export interface ResolvedChatAutomationIntent {
  readonly intent: ChatAutomationIntent;
  readonly mode: AutomationMode;
  readonly source: "deterministic" | "generated";
  readonly requiresReview: boolean;
  readonly generatedConfidence: number | null;
  readonly generatedNeedsConfirmation: boolean;
  readonly reason: string | null;
}

export interface ParsedSchedule {
  readonly schedule: AutomationSchedule;
  readonly cadenceLabel: string;
}

export interface ParsedIterationLimit {
  readonly maxIterations: number;
  readonly textWithoutIterationLimit: string;
}

export interface ParsedExecutionScope {
  readonly executionScope: ChatAutomationExecutionScope;
  readonly textWithoutExecutionScope: string;
}

export interface ParsedStopClause {
  readonly stopWhen: string;
  readonly textWithoutStopClause: string;
}
