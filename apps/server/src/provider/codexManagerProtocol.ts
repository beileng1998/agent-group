import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

import {
  type ProviderInteractionMode,
  type ProviderListPluginsInput,
  type ProviderMentionReference,
  type ProviderReadPluginInput,
  type ProviderSessionStartInput,
  type ProviderSkillReference,
  type ProviderStartReviewInput,
  type ProviderUserInputAnswers,
  RuntimeMode,
  ThreadId,
  TurnId,
} from "@agent-group/contracts";
import { normalizeModelSlug } from "@agent-group/shared/model";
import { prepareWindowsSafeProcess } from "@agent-group/shared/windowsProcess";

import { createLogger } from "../logger";
import {
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
} from "./codexModeInstructions.ts";
import type { CodexUserInputAnswer } from "./codexJsonRpc.ts";
import type {
  CodexAccountSnapshot,
  CodexPlanType,
  CodexSessionApprovalOverride,
  CodexSessionContext,
} from "./codexSessionContext.ts";

export const log = createLogger("codex");

export type CodexApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type CodexTurnSandboxPolicy = {
  readonly type: "readOnly" | "workspaceWrite" | "dangerFullAccess";
};
export interface CodexSkillListInput {
  readonly cwd: string;
  readonly forceReload?: boolean;
  readonly threadId?: string;
}

export interface CodexPluginListInput extends Omit<ProviderListPluginsInput, "provider"> {}

export interface CodexPluginReadInput extends Omit<ProviderReadPluginInput, "provider"> {}

export function shouldRetrySkillsListWithCwdFallback(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("skills/list failed") &&
    (message.includes("invalid") ||
      message.includes("unknown field") ||
      message.includes("unrecognized field") ||
      message.includes("missing field") ||
      message.includes("expected") ||
      message.includes("cwds"))
  );
}

export interface CodexVoiceTranscriptionAuthContext {
  readonly authMethod: "chatgpt" | "chatgptAuthTokens";
  readonly token: string;
}

export interface CodexAppServerSendTurnInput {
  readonly threadId: ThreadId;
  readonly input?: string;
  readonly attachments?: ReadonlyArray<{ type: "image"; url: string }>;
  readonly skills?: ReadonlyArray<ProviderSkillReference>;
  readonly mentions?: ReadonlyArray<ProviderMentionReference>;
  readonly model?: string;
  readonly serviceTier?: string | null;
  readonly effort?: string;
  readonly interactionMode?: ProviderInteractionMode;
}

export type CodexAppServerReviewTarget = ProviderStartReviewInput["target"];

export interface CodexAppServerStartSessionInput {
  readonly threadId: ThreadId;
  readonly provider?: "codex";
  readonly cwd?: string;
  readonly model?: string;
  readonly serviceTier?: string;
  readonly resumeCursor?: unknown;
  readonly providerOptions?: ProviderSessionStartInput["providerOptions"];
  readonly runtimeMode: RuntimeMode;
}

export interface CodexThreadTurnSnapshot {
  id: TurnId;
  items: unknown[];
}

export interface CodexThreadSnapshot {
  threadId: string;
  turns: CodexThreadTurnSnapshot[];
  cwd?: string | null;
}

export const CODEX_VERSION_CHECK_TIMEOUT_MS = 4_000;

export const ANSI_ESCAPE_CHAR = String.fromCharCode(27);
export const ANSI_ESCAPE_REGEX = new RegExp(`${ANSI_ESCAPE_CHAR}\\[[0-9;]*m`, "g");
export const CODEX_STDERR_LOG_REGEX =
  /^\d{4}-\d{2}-\d{2}T\S+\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+\S+:\s+(.*)$/;
export const BENIGN_ERROR_LOG_SNIPPETS = [
  "state db missing rollout path for thread",
  "state db record_discrepancy: find_thread_path_by_id_str_in_subdir, falling_back",
];
export const BENIGN_PROCESS_OUTPUT_REGEXES = [/^(?:\^C)?Token usage:/i];
export const RECOVERABLE_THREAD_RESUME_ERROR_SNIPPETS = [
  "not found",
  "missing thread",
  "no such thread",
  "unknown thread",
  "does not exist",
];
export const CODEX_DEFAULT_MODEL = "gpt-5.5";
export const CODEX_SPARK_MODEL = "gpt-5.3-codex-spark";
export const CODEX_SPARK_DISABLED_PLAN_TYPES = new Set<CodexPlanType>(["free", "go", "plus"]);
export const CODEX_DISCOVERY_SESSION_IDLE_MS = 10 * 60 * 1000;

export function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function normalizeCodexProcessLine(rawLine: string): string {
  return rawLine.replaceAll(ANSI_ESCAPE_REGEX, "").trim();
}

export function isIgnorableCodexProcessLine(rawLine: string): boolean {
  const line = normalizeCodexProcessLine(rawLine);
  if (!line) {
    return true;
  }
  return BENIGN_PROCESS_OUTPUT_REGEXES.some((pattern) => pattern.test(line));
}

export function isCodexProtocolEnvelope(value: Record<string, unknown>): boolean {
  if (typeof value.method === "string") {
    return true;
  }
  const hasId = Object.prototype.hasOwnProperty.call(value, "id");
  return (
    hasId &&
    (Object.prototype.hasOwnProperty.call(value, "result") ||
      Object.prototype.hasOwnProperty.call(value, "error"))
  );
}

export function logIgnoredCodexStdout(rawLine: string, reason: string): void {
  log.warn("ignoring non-protocol codex app-server stdout", {
    reason,
    preview: normalizeCodexProcessLine(rawLine).slice(0, 160),
    length: rawLine.length,
  });
}

export function normalizeCodexUserVisibleErrorMessage(rawMessage: string): string {
  const message = normalizeCodexProcessLine(rawMessage);

  const duplicateFunctionArgMatch = message.match(
    /failed to parse function arguments: duplicate field `([^`]+)`/i,
  );
  if (duplicateFunctionArgMatch) {
    const fieldName = duplicateFunctionArgMatch[1];
    return `Tool call failed because the same argument was sent twice${fieldName ? ` (${fieldName})` : ""}.`;
  }

  return message;
}

export function readCodexAccountSnapshot(response: unknown): CodexAccountSnapshot {
  const record = asObject(response);
  const account = asObject(record?.account) ?? record;
  const accountType = asString(account?.type);

  if (accountType === "apiKey") {
    return {
      type: "apiKey",
      planType: null,
      sparkEnabled: true,
    };
  }

  if (accountType === "chatgpt") {
    const planType = (account?.planType as CodexPlanType | null) ?? "unknown";
    return {
      type: "chatgpt",
      planType,
      sparkEnabled: !CODEX_SPARK_DISABLED_PLAN_TYPES.has(planType),
    };
  }

  return {
    type: "unknown",
    planType: null,
    sparkEnabled: true,
  };
}

export function mapCodexRuntimeMode(runtimeMode: RuntimeMode): {
  readonly approvalPolicy: CodexApprovalPolicy;
  readonly sandbox: CodexSandboxMode;
} {
  switch (runtimeMode) {
    case "approval-required":
      return {
        approvalPolicy: "untrusted",
        sandbox: "read-only",
      };
    case "full-access":
    default:
      return {
        approvalPolicy: "never",
        sandbox: "danger-full-access",
      };
  }
}

// turn/start uses sandboxPolicy objects, so keep this separate from thread/start.
export function mapCodexRuntimeModeToTurnOverrides(runtimeMode: RuntimeMode): {
  readonly approvalPolicy: CodexApprovalPolicy;
  readonly sandboxPolicy: CodexTurnSandboxPolicy;
} {
  switch (runtimeMode) {
    case "approval-required":
      return {
        approvalPolicy: "untrusted",
        sandboxPolicy: { type: "readOnly" },
      };
    case "full-access":
    default:
      return {
        approvalPolicy: "never",
        sandboxPolicy: { type: "dangerFullAccess" },
      };
  }
}

export const CODEX_ALWAYS_ALLOW_SESSION_TURN_OVERRIDES: CodexSessionApprovalOverride = {
  approvalPolicy: "never",
  sandboxPolicy: { type: "dangerFullAccess" },
};

// Agent Group re-sends turn-level Codex permission overrides, so keep "always allow"
// as live session state instead of relying on one native approval reply.
export function resolveCodexTurnOverrides(context: CodexSessionContext): {
  readonly approvalPolicy: CodexApprovalPolicy;
  readonly sandboxPolicy: CodexTurnSandboxPolicy;
} {
  return (
    context.sessionApprovalOverride ??
    mapCodexRuntimeModeToTurnOverrides(context.session.runtimeMode)
  );
}

export function resolveCodexModelForAccount(
  model: string | undefined,
  account: CodexAccountSnapshot,
): string | undefined {
  if (model !== CODEX_SPARK_MODEL || account.sparkEnabled) {
    return model;
  }

  return CODEX_DEFAULT_MODEL;
}

export function spawnCodexAppServer(input: {
  readonly binaryPath: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}): ChildProcessWithoutNullStreams {
  const prepared = prepareWindowsSafeProcess(input.binaryPath, ["app-server"], {
    cwd: input.cwd,
    env: input.env,
  });
  return spawn(prepared.command, prepared.args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: prepared.shell,
    windowsHide: prepared.windowsHide,
    windowsVerbatimArguments: prepared.windowsVerbatimArguments,
  });
}

export function normalizeCodexModelSlug(
  model: string | undefined | null,
  preferredId?: string,
): string | undefined {
  const normalized = normalizeModelSlug(model);
  if (!normalized) {
    return undefined;
  }

  if (preferredId?.endsWith("-codex") && preferredId !== normalized) {
    return preferredId;
  }

  return normalized;
}

export function buildCodexInitializeParams() {
  return {
    clientInfo: {
      name: "agent_group_desktop",
      title: "Agent Group Desktop",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: true,
    },
  } as const;
}

export function buildCodexCollaborationMode(input: {
  readonly interactionMode?: "default" | "plan";
  readonly model?: string;
  readonly effort?: string;
}):
  | {
      mode: "default" | "plan";
      settings: {
        model: string;
        reasoning_effort: string;
        developer_instructions: string;
      };
    }
  | undefined {
  if (input.interactionMode === undefined) {
    return undefined;
  }
  const model = normalizeCodexModelSlug(input.model) ?? "gpt-5.3-codex";
  return {
    mode: input.interactionMode,
    settings: {
      model,
      reasoning_effort: input.effort ?? "medium",
      developer_instructions:
        input.interactionMode === "plan"
          ? CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS
          : CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
    },
  };
}

export function toCodexUserInputAnswer(value: unknown): CodexUserInputAnswer {
  if (typeof value === "string") {
    return { answers: [value] };
  }

  if (Array.isArray(value)) {
    const answers = value.filter((entry): entry is string => typeof entry === "string");
    return { answers };
  }

  if (value && typeof value === "object") {
    const maybeAnswers = (value as { answers?: unknown }).answers;
    if (Array.isArray(maybeAnswers)) {
      const answers = maybeAnswers.filter((entry): entry is string => typeof entry === "string");
      return { answers };
    }
  }

  throw new Error("User input answers must be strings or arrays of strings.");
}

export function toCodexUserInputAnswers(
  answers: ProviderUserInputAnswers,
): Record<string, CodexUserInputAnswer> {
  return Object.fromEntries(
    Object.entries(answers).map(([questionId, value]) => [
      questionId,
      toCodexUserInputAnswer(value),
    ]),
  );
}

export function classifyCodexStderrLine(
  rawLine: string,
): { level: "warn" | "error"; message: string; target?: string } | null {
  if (isIgnorableCodexProcessLine(rawLine)) {
    return null;
  }
  const line = normalizeCodexProcessLine(rawLine);

  try {
    const jsonLog = asObject(JSON.parse(line));
    const rawLevel = asString(jsonLog?.level)?.toUpperCase();
    if (rawLevel) {
      if (rawLevel !== "WARN" && rawLevel !== "WARNING" && rawLevel !== "ERROR") {
        return null;
      }

      const isBenignError = BENIGN_ERROR_LOG_SNIPPETS.some((snippet) =>
        line.includes(snippet),
      );
      if (isBenignError) {
        return null;
      }

      const fields = asObject(jsonLog?.fields);
      const fieldMessage = asString(fields?.message) ?? asString(jsonLog?.message);
      const fieldError = asString(fields?.error);
      const target = asString(jsonLog?.target);
      const message = [fieldMessage, fieldError]
        .filter(
          (value, index, values): value is string =>
            Boolean(value && values.indexOf(value) === index),
        )
        .join(": ");

      return {
        level: rawLevel === "ERROR" ? "error" : "warn",
        message: normalizeCodexUserVisibleErrorMessage(message || line),
        ...(target ? { target } : {}),
      };
    }
  } catch {
    // Plain stderr and text tracing logs are handled below.
  }

  const match = line.match(CODEX_STDERR_LOG_REGEX);
  if (match) {
    const level = match[1];
    if (level && level !== "WARN" && level !== "ERROR") {
      return null;
    }

    const isBenignError = BENIGN_ERROR_LOG_SNIPPETS.some((snippet) => line.includes(snippet));
    if (isBenignError) {
      return null;
    }
  }

  return {
    level: match?.[1] === "WARN" ? "warn" : "error",
    message: normalizeCodexUserVisibleErrorMessage(line),
  };
}

export function isRecoverableThreadResumeError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (!message.includes("thread/resume")) {
    return false;
  }

  return RECOVERABLE_THREAD_RESUME_ERROR_SNIPPETS.some((snippet) => message.includes(snippet));
}
