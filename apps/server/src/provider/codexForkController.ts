import readline from "node:readline";

import {
  type ProviderForkThreadInput,
  type ProviderForkThreadResult,
  type ProviderSession,
  type ThreadId,
} from "@agent-group/contracts";
import { getModelSelectionBooleanOptionValue } from "@agent-group/shared/model";

import { buildCodexProcessEnv } from "../codexProcessEnv.ts";
import {
  buildCodexInitializeParams,
  type CodexAppServerStartSessionInput,
  log,
  mapCodexRuntimeMode,
  normalizeCodexModelSlug,
  readCodexAccountSnapshot,
  resolveCodexModelForAccount,
  spawnCodexAppServer,
} from "./codexManagerProtocol.ts";
import {
  CodexManagerLifecycleCoordinator,
  CodexManagerLifecycleSupersededError,
  type CodexManagerCreationLease,
} from "./codexManagerLifecycle.ts";
import type { CodexSessionContext } from "./codexSessionContext.ts";
import { readCodexProviderOptions, readResumeCursorThreadId } from "./codexManagerValues.ts";
import { ensureIsolatedScratchWorkspace } from "../scratchWorkspaces.ts";

export interface CodexForkControllerDependencies {
  readonly sessions: Map<ThreadId, CodexSessionContext>;
  readonly lifecycle: CodexManagerLifecycleCoordinator;
  readonly assertSupportedCodexCliVersion: (input: {
    readonly binaryPath: string;
    readonly cwd: string;
    readonly homePath?: string;
  }) => void;
  readonly stopSessionContext: (threadId: ThreadId) => Promise<void>;
  readonly attachProcessListeners: (context: CodexSessionContext) => void;
  readonly emitLifecycleEvent: (
    context: CodexSessionContext,
    method: string,
    message: string,
  ) => void;
  readonly sendRequest: <TResponse>(
    context: CodexSessionContext,
    method: string,
    params: unknown,
  ) => Promise<TResponse>;
  readonly writeMessage: (context: CodexSessionContext, message: unknown) => void;
  readonly registerAgentGroupSkillsRoot: (context: CodexSessionContext) => Promise<void>;
  readonly updateSession: (context: CodexSessionContext, updates: Partial<ProviderSession>) => void;
  readonly emitErrorEvent: (context: CodexSessionContext, method: string, message: string) => void;
  readonly readThreadIdFromResponse: (method: string, response: unknown) => string;
}

export class CodexForkController {
  constructor(private readonly dependencies: CodexForkControllerDependencies) {}

  private get sessions() {
    return this.dependencies.sessions;
  }

  private get lifecycle() {
    return this.dependencies.lifecycle;
  }

  private stopSessionContext(threadId: ThreadId): Promise<void> {
    return this.dependencies.stopSessionContext(threadId);
  }

  private attachProcessListeners(context: CodexSessionContext): void {
    this.dependencies.attachProcessListeners(context);
  }

  private emitLifecycleEvent(context: CodexSessionContext, method: string, message: string): void {
    this.dependencies.emitLifecycleEvent(context, method, message);
  }

  private sendRequest<TResponse>(
    context: CodexSessionContext,
    method: string,
    params: unknown,
  ): Promise<TResponse> {
    return this.dependencies.sendRequest<TResponse>(context, method, params);
  }

  private writeMessage(context: CodexSessionContext, message: unknown): void {
    this.dependencies.writeMessage(context, message);
  }

  private registerAgentGroupSkillsRoot(context: CodexSessionContext): Promise<void> {
    return this.dependencies.registerAgentGroupSkillsRoot(context);
  }

  private updateSession(context: CodexSessionContext, updates: Partial<ProviderSession>): void {
    this.dependencies.updateSession(context, updates);
  }

  private emitErrorEvent(context: CodexSessionContext, method: string, message: string): void {
    this.dependencies.emitErrorEvent(context, method, message);
  }

  forkThread(input: ProviderForkThreadInput): Promise<ProviderForkThreadResult> {
    return this.lifecycle.runCreation(`session:${input.threadId}`, (lease) =>
      this.forkThreadInternal(input, lease),
    );
  }

  private async forkThreadInternal(
    input: ProviderForkThreadInput,
    lease: CodexManagerCreationLease,
  ): Promise<ProviderForkThreadResult> {
    const threadId = input.threadId;
    const now = new Date().toISOString();
    let context: CodexSessionContext | undefined;

    try {
      const existing = this.sessions.get(threadId);
      if (existing) {
        await this.stopSessionContext(threadId);
      }

      const sourceProviderThreadId = readResumeCursorThreadId(input.sourceResumeCursor);
      if (!sourceProviderThreadId) {
        throw new Error("Provider fork is missing the source thread resume id.");
      }

      const resolvedCwd = input.cwd ?? ensureIsolatedScratchWorkspace(threadId);
      const session: ProviderSession = {
        provider: "codex",
        status: "connecting",
        runtimeMode: input.runtimeMode,
        model:
          input.modelSelection?.provider === "codex"
            ? normalizeCodexModelSlug(input.modelSelection.model)
            : undefined,
        cwd: resolvedCwd,
        threadId,
        createdAt: now,
        updatedAt: now,
      };

      const codexOptions = readCodexProviderOptions({
        threadId,
        ...(input.providerOptions !== undefined ? { providerOptions: input.providerOptions } : {}),
        runtimeMode: input.runtimeMode,
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      });
      const codexBinaryPath = codexOptions.binaryPath ?? "codex";
      const codexHomePath = codexOptions.homePath;
      this.dependencies.assertSupportedCodexCliVersion({
        binaryPath: codexBinaryPath,
        cwd: resolvedCwd,
        ...(codexHomePath ? { homePath: codexHomePath } : {}),
      });
      lease.assertCurrent();
      const child = spawnCodexAppServer({
        binaryPath: codexBinaryPath,
        cwd: resolvedCwd,
        env: buildCodexProcessEnv({
          ...(codexHomePath ? { homePath: codexHomePath } : {}),
        }),
      });
      const output = readline.createInterface({ input: child.stdout });

      context = {
        session,
        account: {
          type: "unknown",
          planType: null,
          sparkEnabled: true,
        },
        child,
        output,
        pending: new Map(),
        pendingApprovals: new Map(),
        pendingUserInputs: new Map(),
        collabReceiverTurns: new Map(),
        collabReceiverParents: new Map(),
        reviewTurnIds: new Set(),
        nextRequestId: 1,
        stopping: false,
      };

      this.sessions.set(threadId, context);
      this.attachProcessListeners(context);
      this.emitLifecycleEvent(context, "session/connecting", "Starting codex app-server");

      await this.sendRequest(context, "initialize", buildCodexInitializeParams());
      this.writeMessage(context, { method: "initialized" });
      await this.registerAgentGroupSkillsRoot(context);
      lease.assertCurrent();
      try {
        const accountReadResponse = await this.sendRequest(context, "account/read", {});
        context.account = readCodexAccountSnapshot(accountReadResponse);
      } catch {
        // Fork can proceed without account metadata; model fallback will stay best-effort.
      }
      lease.assertCurrent();

      const normalizedModel =
        input.modelSelection?.provider === "codex"
          ? resolveCodexModelForAccount(
              normalizeCodexModelSlug(input.modelSelection.model),
              context.account,
            )
          : undefined;
      const useFastServiceTier =
        input.modelSelection?.provider === "codex" &&
        getModelSelectionBooleanOptionValue(input.modelSelection, "fastMode") === true;
      const forkParams = {
        threadId: sourceProviderThreadId,
        ...(normalizedModel ? { model: normalizedModel } : {}),
        ...(useFastServiceTier ? { serviceTier: "fast" as const } : {}),
        cwd: resolvedCwd,
        ...mapCodexRuntimeMode(input.runtimeMode),
      };

      this.emitLifecycleEvent(
        context,
        "session/threadOpenRequested",
        `Forking Codex thread ${sourceProviderThreadId}.`,
      );
      const response = await this.sendRequest(context, "thread/fork", forkParams);
      const forkedProviderThreadId = this.dependencies.readThreadIdFromResponse(
        "thread/fork",
        response,
      );

      this.updateSession(context, {
        status: "ready",
        resumeCursor: { threadId: forkedProviderThreadId },
      });
      this.emitLifecycleEvent(context, "session/threadOpenResolved", "Codex thread/fork resolved.");
      this.emitLifecycleEvent(
        context,
        "session/ready",
        `Connected to thread ${forkedProviderThreadId}`,
      );
      lease.assertCurrent();

      return {
        threadId,
        resumeCursor: {
          threadId: forkedProviderThreadId,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fork Codex thread.";
      const superseded =
        error instanceof CodexManagerLifecycleSupersededError || context?.stopping === true;
      if (context) {
        if (!superseded) {
          this.updateSession(context, { status: "error", lastError: message });
          this.emitErrorEvent(context, "session/threadForkFailed", message);
        }
        await this.stopSessionContext(threadId);
      }
      throw new Error(message, { cause: error });
    }
  }
}
