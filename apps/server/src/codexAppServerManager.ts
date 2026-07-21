import { EventEmitter } from "node:events";

import {
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderComposerCapabilities,
  type ProviderEvent,
  type ProviderForkThreadInput,
  type ProviderForkThreadResult,
  type ProviderListModelsResult,
  type ProviderListPluginsResult,
  type ProviderListSkillsResult,
  type ProviderReadPluginResult,
  type ProviderSession,
  type ProviderStartReviewInput,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
  type ServerVoiceTranscriptionInput,
  type ServerVoiceTranscriptionResult,
  ThreadId,
  TurnId,
} from "@agent-group/contracts";
import { Effect, ServiceMap } from "effect";

import { assertSupportedCodexCliVersion } from "./provider/codexCliGuard.ts";
import { CodexDiscoveryController } from "./provider/codexDiscoveryController.ts";
import { CodexForkController } from "./provider/codexForkController.ts";
import {
  CodexManagerLifecycleCoordinator,
  type CodexManagerCreationLease,
} from "./provider/codexManagerLifecycle.ts";
import type {
  CodexAppServerSendTurnInput,
  CodexAppServerStartSessionInput,
  CodexPluginListInput,
  CodexPluginReadInput,
  CodexSkillListInput,
  CodexThreadSnapshot,
} from "./provider/codexManagerProtocol.ts";
import { CodexNotificationRouter } from "./provider/codexNotificationRouter.ts";
import { CodexProcessTransport } from "./provider/codexProcessTransport.ts";
import { CodexRequestRouter } from "./provider/codexRequestRouter.ts";
import { CodexReviewController } from "./provider/codexReviewController.ts";
import { CodexSessionLifecycle } from "./provider/codexSessionLifecycle.ts";
import type {
  CodexJsonRpcNotification as JsonRpcNotification,
  CodexJsonRpcRequest as JsonRpcRequest,
} from "./provider/codexJsonRpc.ts";
import type { CodexSessionContext } from "./provider/codexSessionContext.ts";
import type { ProviderProcessTreeTeardown } from "./provider/codexSessionTeardown.ts";
import { CodexThreadController } from "./provider/codexThreadController.ts";
import { CodexTurnController } from "./provider/codexTurnController.ts";
import { teardownProviderProcessTree } from "./provider/supervisedProcessTeardown.ts";

export {
  buildCodexInitializeParams,
  classifyCodexStderrLine,
  normalizeCodexModelSlug,
  readCodexAccountSnapshot,
  resolveCodexModelForAccount,
  isRecoverableThreadResumeError,
} from "./provider/codexManagerProtocol.ts";
export type {
  CodexAppServerSendTurnInput,
  CodexAppServerStartSessionInput,
  CodexThreadSnapshot,
  CodexThreadTurnSnapshot,
} from "./provider/codexManagerProtocol.ts";
export {
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
} from "./provider/codexModeInstructions.ts";

export interface CodexAppServerManagerEvents {
  event: [event: ProviderEvent];
}

export class CodexAppServerManager extends EventEmitter<CodexAppServerManagerEvents> {
  private readonly sessions = new Map<ThreadId, CodexSessionContext>();
  private readonly lifecycle = new CodexManagerLifecycleCoordinator();

  private runPromise: (effect: Effect.Effect<unknown, never>) => Promise<unknown>;
  private readonly agentGroupSkillsDir: string | undefined;
  private readonly teardownProcessTree: ProviderProcessTreeTeardown;
  private readonly threadController: CodexThreadController;
  private readonly turnController: CodexTurnController;
  private readonly requestRouter: CodexRequestRouter;
  private readonly transport: CodexProcessTransport;
  private readonly notificationRouter: CodexNotificationRouter;
  private readonly discoveryController: CodexDiscoveryController;
  private readonly forkController: CodexForkController;
  private readonly sessionLifecycle: CodexSessionLifecycle;
  private readonly reviewController: CodexReviewController;
  constructor(
    services?: ServiceMap.ServiceMap<never>,
    options?: {
      readonly agentGroupSkillsDir?: string;
      readonly teardownProcessTree?: ProviderProcessTreeTeardown;
    },
  ) {
    super();
    this.runPromise = services ? Effect.runPromiseWith(services) : Effect.runPromise;
    this.agentGroupSkillsDir = options?.agentGroupSkillsDir;
    this.teardownProcessTree = options?.teardownProcessTree ?? teardownProviderProcessTree;
    this.discoveryController = new CodexDiscoveryController({
      sessions: this.sessions,
      lifecycle: this.lifecycle,
      teardownProcessTree: this.teardownProcessTree,
      assertSupportedCodexCliVersion: (input) => this.assertSupportedCodexCliVersion(input),
      requireSession: (threadId) => this.requireSession(threadId),
      resolveContextForDiscovery: (threadId, cwd) =>
        cwd === undefined
          ? this.resolveContextForDiscovery(threadId)
          : this.resolveContextForDiscovery(threadId, cwd),
      getOrCreateDiscoverySession: (cwd) => this.getOrCreateDiscoverySession(cwd),
      sendRequest: (context, method, params) => this.sendRequest(context, method, params),
      attachProcessListeners: (context) => this.attachProcessListeners(context),
      writeMessage: (context, message) => this.writeMessage(context, message),
      registerAgentGroupSkillsRoot: (context) => this.registerAgentGroupSkillsRoot(context),
      updateSession: (context, updates) => this.updateSession(context, updates),
    });
    this.transport = new CodexProcessTransport({
      sessions: this.sessions,
      discoverySessions: this.discoveryController.discoverySessions,
      updateSession: (context, updates) => this.updateSession(context, updates),
      handleServerRequest: (context, request) => this.handleServerRequest(context, request),
      handleServerNotification: (context, notification) =>
        this.handleServerNotification(context, notification),
      publishEvent: (event) => this.emitEvent(event),
    });
    this.sessionLifecycle = new CodexSessionLifecycle({
      sessions: this.sessions,
      lifecycle: this.lifecycle,
      agentGroupSkillsDir: this.agentGroupSkillsDir,
      teardownProcessTree: this.teardownProcessTree,
      runPromise: (effect: Effect.Effect<unknown, never>) => this.runPromise(effect),
      assertSupportedCodexCliVersion: (input) => this.assertSupportedCodexCliVersion(input),
      attachProcessListeners: (context) => this.attachProcessListeners(context),
      sendRequest: (context, method, params) => this.sendRequest(context, method, params),
      writeMessage: (context, message) => this.writeMessage(context, message),
      emitLifecycleEvent: (context, method, message) =>
        this.emitLifecycleEvent(context, method, message),
      emitErrorEvent: (context, method, message) => this.emitErrorEvent(context, method, message),
      emitEvent: (event) => this.emitEvent(event),
      discoverySessionKeys: () => this.discoveryController.discoverySessions.keys(),
      stopDiscoverySessionContext: (key) =>
        this.discoveryController.stopDiscoverySessionContext(key),
    });
    this.notificationRouter = new CodexNotificationRouter({
      updateSession: (context, updates) => this.updateSession(context, updates),
      emitEvent: (event) => this.emitEvent(event),
      settleTrackedReview: (context, input) => this.settleTrackedReview(context, input),
    });
    this.threadController = new CodexThreadController({
      requireSession: (threadId) => this.requireSession(threadId),
      resolveContextForDiscovery: (threadId, cwd) => this.resolveContextForDiscovery(threadId, cwd),
      sendRequest: (context, method, params) => this.sendRequest(context, method, params),
      updateSession: (context, updates) => this.updateSession(context, updates),
      emitEvent: (event) => this.emitEvent(event),
      runPromise: (effect) => this.runPromise(effect),
    });
    this.reviewController = new CodexReviewController({
      requireSession: (threadId) => this.requireSession(threadId),
      sendRequest: (context, method, params) => this.sendRequest(context, method, params),
      readThread: (threadId) => this.threadController.readThread(threadId),
      updateSession: (context, updates) => this.updateSession(context, updates),
      emitEvent: (event) => this.emitEvent(event),
    });
    this.turnController = new CodexTurnController({
      requireSession: (threadId) => this.requireSession(threadId),
      sendRequest: (context, method, params) => this.sendRequest(context, method, params),
      updateSession: (context, updates) => this.updateSession(context, updates),
    });
    this.forkController = new CodexForkController({
      sessions: this.sessions,
      lifecycle: this.lifecycle,
      assertSupportedCodexCliVersion: (input) => this.assertSupportedCodexCliVersion(input),
      stopSessionContext: (threadId) => this.stopSessionContext(threadId),
      attachProcessListeners: (context) => this.attachProcessListeners(context),
      emitLifecycleEvent: (context, method, message) =>
        this.emitLifecycleEvent(context, method, message),
      sendRequest: (context, method, params) => this.sendRequest(context, method, params),
      writeMessage: (context, message) => this.writeMessage(context, message),
      registerAgentGroupSkillsRoot: (context) => this.registerAgentGroupSkillsRoot(context),
      updateSession: (context, updates) => this.updateSession(context, updates),
      emitErrorEvent: (context, method, message) => this.emitErrorEvent(context, method, message),
      readThreadIdFromResponse: (method, response) =>
        this.threadController.readThreadIdFromResponse(method, response),
    });
    this.requestRouter = new CodexRequestRouter({
      requireSession: (threadId) => this.requireSession(threadId),
      writeMessage: (context, message) => this.writeMessage(context, message),
      emitEvent: (event) => this.emitEvent(event),
    });
  }

  // Registers `~/.agent-group/skills` as a codex skill root so portable skills are
  // first-class: skills/list returns them and turn/start `skill` items inject
  // their instructions. Verified live: skill items with paths outside known
  // roots are silently ignored by codex app-server, so this call is required.
  private registerAgentGroupSkillsRoot(context: CodexSessionContext): Promise<void> {
    return this.sessionLifecycle.registerAgentGroupSkillsRoot(context);
  }

  private assertSupportedCodexCliVersion(input: {
    readonly binaryPath: string;
    readonly cwd: string;
    readonly homePath?: string;
  }): void {
    assertSupportedCodexCliVersion(input);
  }

  startSession(input: CodexAppServerStartSessionInput): Promise<ProviderSession> {
    return this.lifecycle.runCreation(`session:${input.threadId}`, (lease) =>
      this.startSessionInternal(input, lease),
    );
  }

  private startSessionInternal(
    input: CodexAppServerStartSessionInput,
    lease: CodexManagerCreationLease,
  ): Promise<ProviderSession> {
    return this.sessionLifecycle.startSessionInternal(input, lease);
  }

  async sendTurn(input: CodexAppServerSendTurnInput): Promise<ProviderTurnStartResult> {
    return this.turnController.sendTurn(input);
  }

  async steerTurn(input: CodexAppServerSendTurnInput): Promise<ProviderTurnStartResult> {
    return this.turnController.steerTurn(input);
  }

  async startReview(input: ProviderStartReviewInput): Promise<ProviderTurnStartResult> {
    return this.reviewController.startReview(input);
  }

  async interruptTurn(
    threadId: ThreadId,
    turnId?: TurnId,
    providerThreadIdOverride?: string,
  ): Promise<void> {
    return this.reviewController.interruptTurn(threadId, turnId, providerThreadIdOverride);
  }

  async readThread(threadId: ThreadId): Promise<CodexThreadSnapshot> {
    return this.threadController.readThread(threadId);
  }

  async readExternalThread(input: {
    externalThreadId: string;
    cwd?: string;
  }): Promise<CodexThreadSnapshot> {
    return this.threadController.readExternalThread(input);
  }

  forkThread(input: ProviderForkThreadInput): Promise<ProviderForkThreadResult> {
    return this.forkController.forkThread(input);
  }

  async rollbackThread(threadId: ThreadId, numTurns: number): Promise<CodexThreadSnapshot> {
    return this.threadController.rollbackThread(threadId, numTurns);
  }

  async compactThread(threadId: ThreadId): Promise<void> {
    return this.threadController.compactThread(threadId);
  }

  async respondToRequest(
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ): Promise<void> {
    return this.requestRouter.respondToRequest(threadId, requestId, decision);
  }

  async respondToUserInput(
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ): Promise<void> {
    return this.requestRouter.respondToUserInput(threadId, requestId, answers);
  }

  stopSession(threadId: ThreadId): Promise<void> {
    return this.sessionLifecycle.stopSession(threadId);
  }

  private stopSessionContext(threadId: ThreadId): Promise<void> {
    return this.sessionLifecycle.stopSessionContext(threadId);
  }

  listSessions(): ProviderSession[] {
    return this.sessionLifecycle.listSessions();
  }

  hasSession(threadId: ThreadId): boolean {
    return this.sessionLifecycle.hasSession(threadId);
  }

  stopAll(): Promise<void> {
    return this.lifecycle.runStopAll(() => this.stopAllContexts());
  }

  close(): Promise<void> {
    return this.lifecycle.runClose(() => this.stopAllContexts());
  }

  private stopAllContexts(): Promise<void> {
    return this.sessionLifecycle.stopAllContexts();
  }

  async listSkills(input: CodexSkillListInput): Promise<ProviderListSkillsResult> {
    return this.discoveryController.listSkills(input);
  }

  async listPlugins(input: CodexPluginListInput): Promise<ProviderListPluginsResult> {
    return this.discoveryController.listPlugins(input);
  }

  async readPlugin(input: CodexPluginReadInput): Promise<ProviderReadPluginResult> {
    return this.discoveryController.readPlugin(input);
  }

  async listModels(threadId?: string): Promise<ProviderListModelsResult> {
    return this.discoveryController.listModels(threadId);
  }

  async transcribeVoice(
    input: ServerVoiceTranscriptionInput,
  ): Promise<ServerVoiceTranscriptionResult> {
    return this.discoveryController.transcribeVoice(input);
  }

  getComposerCapabilities(): ProviderComposerCapabilities {
    return this.discoveryController.getComposerCapabilities();
  }

  private requireSession(threadId: ThreadId): CodexSessionContext {
    return this.sessionLifecycle.requireSession(threadId);
  }

  private resolveContextForDiscovery(
    threadId?: string,
    cwd?: string,
  ): Promise<CodexSessionContext> {
    return this.discoveryController.resolveContextForDiscovery(threadId, cwd);
  }

  private getOrCreateDiscoverySession(cwd: string): Promise<CodexSessionContext> {
    return this.discoveryController.getOrCreateDiscoverySession(cwd);
  }

  private attachProcessListeners(context: CodexSessionContext): void {
    this.transport.attachProcessListeners(context);
  }

  private handleStdoutLine(context: CodexSessionContext, line: string): void {
    this.transport.handleStdoutLine(context, line);
  }
  private handleServerNotification(
    context: CodexSessionContext,
    notification: JsonRpcNotification,
  ): void {
    this.notificationRouter.handleServerNotification(context, notification);
  }

  private handleServerRequest(context: CodexSessionContext, request: JsonRpcRequest): void {
    this.requestRouter.handleServerRequest(context, request);
  }

  private sendRequest<TResponse>(
    context: CodexSessionContext,
    method: string,
    params: unknown,
    timeoutMs = 20_000,
  ): Promise<TResponse> {
    return this.transport.sendRequest<TResponse>(context, method, params, timeoutMs);
  }

  private writeMessage(context: CodexSessionContext, message: unknown): void {
    this.transport.writeMessage(context, message);
  }

  private emitLifecycleEvent(context: CodexSessionContext, method: string, message: string): void {
    this.transport.emitLifecycleEvent(context, method, message);
  }

  private emitErrorEvent(context: CodexSessionContext, method: string, message: string): void {
    this.transport.emitErrorEvent(context, method, message);
  }

  private emitEvent(event: ProviderEvent): void {
    this.emit("event", event);
  }
  private settleTrackedReview(
    context: CodexSessionContext,
    input: { readonly completedTurnId?: TurnId; readonly reason: string },
  ): void {
    this.reviewController.settleTrackedReview(context, input);
  }

  private updateSession(context: CodexSessionContext, updates: Partial<ProviderSession>): void {
    this.sessionLifecycle.updateSession(context, updates);
  }
}
