import readline from "node:readline";
import { randomUUID } from "node:crypto";

import {
  EventId,
  type ProviderEvent,
  type ProviderSession,
  ThreadId,
} from "@agent-group/contracts";
import { Effect } from "effect";

import { buildCodexProcessEnv } from "../codexProcessEnv.ts";
import {
  buildCodexInitializeParams,
  type CodexAppServerStartSessionInput,
  isRecoverableThreadResumeError,
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
import { readObject, readString } from "./codexJsonValues.ts";
import type { CodexSessionContext } from "./codexSessionContext.ts";
import {
  stopCodexSessionContext,
  type ProviderProcessTreeTeardown,
} from "./codexSessionTeardown.ts";
import { readCodexProviderOptions, readResumeThreadId } from "./codexManagerValues.ts";
import { ensureIsolatedScratchWorkspace } from "../scratchWorkspaces.ts";

export interface CodexSessionLifecycleDependencies {
  readonly sessions: Map<ThreadId, CodexSessionContext>;
  readonly lifecycle: CodexManagerLifecycleCoordinator;
  readonly agentGroupSkillsDir?: string | undefined;
  readonly teardownProcessTree: ProviderProcessTreeTeardown;
  readonly assertSupportedCodexCliVersion: (input: {
    readonly binaryPath: string;
    readonly cwd: string;
    readonly homePath?: string;
  }) => void;
  readonly attachProcessListeners: (context: CodexSessionContext) => void;
  readonly sendRequest: <TResponse>(
    context: CodexSessionContext,
    method: string,
    params: unknown,
  ) => Promise<TResponse>;
  readonly writeMessage: (context: CodexSessionContext, message: unknown) => void;
  readonly emitLifecycleEvent: (
    context: CodexSessionContext,
    method: string,
    message: string,
  ) => void;
  readonly emitErrorEvent: (context: CodexSessionContext, method: string, message: string) => void;
  readonly emitEvent: (event: ProviderEvent) => void;
  readonly discoverySessionKeys: () => Iterable<string>;
  readonly stopDiscoverySessionContext: (key: string) => Promise<void>;
  readonly runPromise: (effect: Effect.Effect<unknown, never>) => Promise<unknown>;
}

export class CodexSessionLifecycle {
  constructor(private readonly dependencies: CodexSessionLifecycleDependencies) {}

  private get sessions() {
    return this.dependencies.sessions;
  }

  private get lifecycle() {
    return this.dependencies.lifecycle;
  }

  private get agentGroupSkillsDir() {
    return this.dependencies.agentGroupSkillsDir;
  }

  private get teardownProcessTree() {
    return this.dependencies.teardownProcessTree;
  }

  private get runPromise() {
    return this.dependencies.runPromise;
  }

  private attachProcessListeners(context: CodexSessionContext): void {
    this.dependencies.attachProcessListeners(context);
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

  private emitLifecycleEvent(context: CodexSessionContext, method: string, message: string): void {
    this.dependencies.emitLifecycleEvent(context, method, message);
  }

  private emitErrorEvent(context: CodexSessionContext, method: string, message: string): void {
    this.dependencies.emitErrorEvent(context, method, message);
  }

  private emitEvent(event: ProviderEvent): void {
    this.dependencies.emitEvent(event);
  }

  async registerAgentGroupSkillsRoot(context: CodexSessionContext): Promise<void> {
    if (!this.agentGroupSkillsDir) {
      return;
    }
    try {
      await this.sendRequest(context, "skills/extraRoots/set", {
        extraRoots: [this.agentGroupSkillsDir],
      });
    } catch (error) {
      // Older codex builds (< extra-roots support) keep working; Agent Group-only
      // skills simply stay invisible to codex on those versions.
      log.warn("skills/extraRoots/set unavailable", { error });
    }
  }

  startSession(input: CodexAppServerStartSessionInput): Promise<ProviderSession> {
    return this.lifecycle.runCreation(`session:${input.threadId}`, (lease) =>
      this.startSessionInternal(input, lease),
    );
  }

  async startSessionInternal(
    input: CodexAppServerStartSessionInput,
    lease: CodexManagerCreationLease,
  ): Promise<ProviderSession> {
    const threadId = input.threadId;
    const now = new Date().toISOString();
    let context: CodexSessionContext | undefined;

    try {
      const existing = this.sessions.get(threadId);
      if (existing) {
        await this.stopSessionContext(threadId);
      }

      const resolvedCwd = input.cwd ?? ensureIsolatedScratchWorkspace(threadId);

      const session: ProviderSession = {
        provider: "codex",
        status: "connecting",
        runtimeMode: input.runtimeMode,
        model: normalizeCodexModelSlug(input.model),
        cwd: resolvedCwd,
        threadId,
        createdAt: now,
        updatedAt: now,
      };

      const codexOptions = readCodexProviderOptions(input);
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
        const modelListResponse = await this.sendRequest(context, "model/list", {});
        log.info("model/list response", { modelListResponse });
      } catch (error) {
        log.warn("model/list failed", { error });
      }
      lease.assertCurrent();
      try {
        const accountReadResponse = await this.sendRequest(context, "account/read", {});
        log.info("account/read response", { accountReadResponse });
        context.account = readCodexAccountSnapshot(accountReadResponse);
        log.info("subscription status", {
          type: context.account.type,
          planType: context.account.planType,
          sparkEnabled: context.account.sparkEnabled,
        });
      } catch (error) {
        log.warn("account/read failed", { error });
      }
      lease.assertCurrent();

      const normalizedModel = resolveCodexModelForAccount(
        normalizeCodexModelSlug(input.model),
        context.account,
      );
      const sessionOverrides = {
        model: normalizedModel ?? null,
        ...(input.serviceTier !== undefined ? { serviceTier: input.serviceTier } : {}),
        cwd: resolvedCwd,
        ...mapCodexRuntimeMode(input.runtimeMode ?? "full-access"),
      };

      const threadStartParams = {
        ...sessionOverrides,
        experimentalRawEvents: false,
      };
      const resumeThreadId = readResumeThreadId(input);
      this.emitLifecycleEvent(
        context,
        "session/threadOpenRequested",
        resumeThreadId
          ? `Attempting to resume thread ${resumeThreadId}.`
          : "Starting a new Codex thread.",
      );
      await Effect.logInfo("codex app-server opening thread", {
        threadId,
        requestedRuntimeMode: input.runtimeMode,
        requestedModel: normalizedModel ?? null,
        requestedCwd: resolvedCwd,
        resumeThreadId: resumeThreadId ?? null,
      }).pipe(this.runPromise);

      let threadOpenMethod: "thread/start" | "thread/resume" = "thread/start";
      let threadOpenResponse: unknown;
      if (resumeThreadId) {
        try {
          threadOpenMethod = "thread/resume";
          threadOpenResponse = await this.sendRequest(context, "thread/resume", {
            ...sessionOverrides,
            threadId: resumeThreadId,
          });
        } catch (error) {
          if (!isRecoverableThreadResumeError(error)) {
            this.emitErrorEvent(
              context,
              "session/threadResumeFailed",
              error instanceof Error ? error.message : "Codex thread resume failed.",
            );
            await Effect.logWarning("codex app-server thread resume failed", {
              threadId,
              requestedRuntimeMode: input.runtimeMode,
              resumeThreadId,
              recoverable: false,
              cause: error instanceof Error ? error.message : String(error),
            }).pipe(this.runPromise);
            throw error;
          }

          threadOpenMethod = "thread/start";
          this.emitLifecycleEvent(
            context,
            "session/threadResumeFallback",
            `Could not resume thread ${resumeThreadId}; started a new thread instead.`,
          );
          await Effect.logWarning("codex app-server thread resume fell back to fresh start", {
            threadId,
            requestedRuntimeMode: input.runtimeMode,
            resumeThreadId,
            recoverable: true,
            cause: error instanceof Error ? error.message : String(error),
          }).pipe(this.runPromise);
          threadOpenResponse = await this.sendRequest(context, "thread/start", threadStartParams);
        }
      } else {
        threadOpenMethod = "thread/start";
        threadOpenResponse = await this.sendRequest(context, "thread/start", threadStartParams);
      }

      const threadOpenRecord = readObject(threadOpenResponse);
      const threadIdRaw =
        readString(readObject(threadOpenRecord, "thread"), "id") ??
        readString(threadOpenRecord, "threadId");
      if (!threadIdRaw) {
        throw new Error(`${threadOpenMethod} response did not include a thread id.`);
      }
      const providerThreadId = threadIdRaw;

      this.updateSession(context, {
        status: "ready",
        resumeCursor: { threadId: providerThreadId },
      });
      this.emitLifecycleEvent(
        context,
        "session/threadOpenResolved",
        `Codex ${threadOpenMethod} resolved.`,
      );
      await Effect.logInfo("codex app-server thread open resolved", {
        threadId,
        threadOpenMethod,
        requestedResumeThreadId: resumeThreadId ?? null,
        resolvedThreadId: providerThreadId,
        requestedRuntimeMode: input.runtimeMode,
      }).pipe(this.runPromise);
      lease.assertCurrent();
      this.emitLifecycleEvent(context, "session/ready", `Connected to thread ${providerThreadId}`);
      return { ...context.session };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start Codex session.";
      const superseded =
        error instanceof CodexManagerLifecycleSupersededError || context?.stopping === true;
      if (context) {
        if (!superseded) {
          this.updateSession(context, { status: "error", lastError: message });
          this.emitErrorEvent(context, "session/startFailed", message);
        }
        await this.stopSessionContext(threadId);
      } else if (!superseded) {
        this.emitEvent({
          id: EventId.makeUnsafe(randomUUID()),
          kind: "error",
          provider: "codex",
          threadId,
          createdAt: new Date().toISOString(),
          method: "session/startFailed",
          message,
        });
      }
      throw new Error(message, { cause: error });
    }
  }

  stopSession(threadId: ThreadId): Promise<void> {
    return this.lifecycle.runMutation(`session:${threadId}`, () =>
      this.stopSessionContext(threadId),
    );
  }

  async stopSessionContext(threadId: ThreadId): Promise<void> {
    const context = this.sessions.get(threadId);
    if (!context) return;
    return stopCodexSessionContext({
      context,
      teardownProcessTree: this.teardownProcessTree,
      pendingError: new Error("Session stopped before request completed."),
      onExitProven: () => {
        this.updateSession(context, { status: "closed", activeTurnId: undefined });
        this.emitLifecycleEvent(context, "session/closed", "Session stopped");
        if (this.sessions.get(threadId) === context) this.sessions.delete(threadId);
      },
    });
  }

  listSessions(): ProviderSession[] {
    return Array.from(this.sessions.values(), ({ session }) => ({
      ...session,
    }));
  }

  hasSession(threadId: ThreadId): boolean {
    const context = this.sessions.get(threadId);
    return context !== undefined && !context.stopping;
  }

  stopAll(): Promise<void> {
    return this.lifecycle.runStopAll(() => this.stopAllContexts());
  }

  /** Permanently closes this manager; unlike stopAll, no later provider creation is admitted. */
  close(): Promise<void> {
    return this.lifecycle.runClose(() => this.stopAllContexts());
  }

  async stopAllContexts(): Promise<void> {
    const results = await Promise.allSettled([
      ...Array.from(this.sessions.keys(), (threadId) => this.stopSessionContext(threadId)),
      ...Array.from(this.dependencies.discoverySessionKeys(), (key) =>
        this.dependencies.stopDiscoverySessionContext(key),
      ),
    ]);
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "One or more Codex app-server process trees did not exit.",
      );
    }
  }

  requireSession(threadId: ThreadId): CodexSessionContext {
    const context = this.sessions.get(threadId);
    if (!context || context.stopping) {
      throw new Error(`Unknown session for thread: ${threadId}`);
    }

    if (context.session.status === "closed") {
      throw new Error(`Session is closed for thread: ${threadId}`);
    }

    return context;
  }

  updateSession(context: CodexSessionContext, updates: Partial<ProviderSession>): void {
    context.session = {
      ...context.session,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
  }
}
