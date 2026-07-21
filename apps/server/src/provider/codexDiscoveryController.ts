import readline from "node:readline";

import {
  type ProviderComposerCapabilities,
  type ProviderListModelsResult,
  type ProviderListPluginsResult,
  type ProviderListSkillsResult,
  type ProviderReadPluginResult,
  type ProviderSession,
  type ServerVoiceTranscriptionInput,
  type ServerVoiceTranscriptionResult,
  ThreadId,
} from "@agent-group/contracts";

import { getRecentCacheEntry, setRecentCacheEntry } from "./codexDiscoveryCache.ts";
import {
  parseModelListResponse,
  parsePluginListResponse,
  parsePluginReadResponse,
  parseSkillsListResponse,
} from "./codexDiscoveryParsers.ts";
import {
  CODEX_DEFAULT_MODEL,
  CODEX_DISCOVERY_SESSION_IDLE_MS,
  buildCodexInitializeParams,
  type CodexPluginListInput,
  type CodexPluginReadInput,
  type CodexSkillListInput,
  type CodexVoiceTranscriptionAuthContext,
  log,
  readCodexAccountSnapshot,
  shouldRetrySkillsListWithCwdFallback,
  spawnCodexAppServer,
} from "./codexManagerProtocol.ts";
import type {
  CodexManagerCreationLease,
  CodexManagerLifecycleCoordinator,
} from "./codexManagerLifecycle.ts";
import type { CodexCliVersionCheckInput } from "./codexCliGuard.ts";
import { readString } from "./codexJsonValues.ts";
import type { CodexSessionContext } from "./codexSessionContext.ts";
import {
  stopCodexSessionContext,
  type ProviderProcessTreeTeardown,
} from "./codexSessionTeardown.ts";
import { buildCodexProcessEnv } from "../codexProcessEnv.ts";
import { transcribeVoiceWithChatGptSession } from "../voiceTranscription.ts";

export interface CodexDiscoveryControllerDependencies {
  readonly sessions: Map<ThreadId, CodexSessionContext>;
  readonly lifecycle: CodexManagerLifecycleCoordinator;
  readonly teardownProcessTree: ProviderProcessTreeTeardown;
  readonly assertSupportedCodexCliVersion: (input: CodexCliVersionCheckInput) => void;
  readonly requireSession: (threadId: ThreadId) => CodexSessionContext;
  readonly resolveContextForDiscovery: (
    threadId?: string,
    cwd?: string,
  ) => Promise<CodexSessionContext>;
  readonly getOrCreateDiscoverySession: (cwd: string) => Promise<CodexSessionContext>;
  readonly sendRequest: <TResponse>(
    context: CodexSessionContext,
    method: string,
    params: unknown,
  ) => Promise<TResponse>;
  readonly attachProcessListeners: (context: CodexSessionContext) => void;
  readonly writeMessage: (context: CodexSessionContext, message: unknown) => void;
  readonly registerAgentGroupSkillsRoot: (context: CodexSessionContext) => Promise<void>;
  readonly updateSession: (context: CodexSessionContext, updates: Partial<ProviderSession>) => void;
}

export class CodexDiscoveryController {
  readonly discoverySessions = new Map<string, CodexSessionContext>();
  private readonly discoverySessionIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly skillsCache = new Map<string, ProviderListSkillsResult>();
  private readonly pluginsCache = new Map<string, ProviderListPluginsResult>();
  private readonly pluginDetailCache = new Map<string, ProviderReadPluginResult>();
  private readonly modelCache = new Map<string, ProviderListModelsResult>();

  constructor(private readonly dependencies: CodexDiscoveryControllerDependencies) {}
  private get sessions() {
    return this.dependencies.sessions;
  }

  private get lifecycle() {
    return this.dependencies.lifecycle;
  }

  private get teardownProcessTree() {
    return this.dependencies.teardownProcessTree;
  }

  private requireSession(threadId: ThreadId): CodexSessionContext {
    return this.dependencies.requireSession(threadId);
  }

  private sendRequest<TResponse>(
    context: CodexSessionContext,
    method: string,
    params: unknown,
  ): Promise<TResponse> {
    return this.dependencies.sendRequest<TResponse>(context, method, params);
  }

  private attachProcessListeners(context: CodexSessionContext): void {
    this.dependencies.attachProcessListeners(context);
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

  async listSkills(input: CodexSkillListInput): Promise<ProviderListSkillsResult> {
    const cwd = input.cwd.trim();
    const cacheKey = JSON.stringify({
      cwd,
      threadId: input.threadId?.trim() || null,
    });
    if (!input.forceReload) {
      const cached = getRecentCacheEntry(this.skillsCache, cacheKey);
      if (cached) {
        return {
          ...cached,
          cached: true,
        };
      }
    }

    const context = await this.dependencies.resolveContextForDiscovery(input.threadId, cwd);
    let response: Record<string, unknown>;
    try {
      response = await this.sendRequest<Record<string, unknown>>(context, "skills/list", {
        cwds: [cwd],
        ...(input.forceReload ? { forceReload: true } : {}),
      });
    } catch (error) {
      if (!shouldRetrySkillsListWithCwdFallback(error)) {
        throw error;
      }
      response = await this.sendRequest<Record<string, unknown>>(context, "skills/list", {
        cwd,
        ...(input.forceReload ? { forceReload: true } : {}),
      });
    }
    const skills = parseSkillsListResponse(response, cwd);
    const result: ProviderListSkillsResult = {
      skills,
      source: "codex-app-server",
      cached: false,
    };
    setRecentCacheEntry(this.skillsCache, cacheKey, result);
    return result;
  }

  async listPlugins(input: CodexPluginListInput): Promise<ProviderListPluginsResult> {
    const cwd = input.cwd?.trim() || null;
    const cacheKey = JSON.stringify({
      cwd,
      threadId: input.threadId?.trim() || null,
      forceRemoteSync: input.forceRemoteSync === true,
    });
    if (!input.forceReload) {
      const cached = getRecentCacheEntry(this.pluginsCache, cacheKey);
      if (cached) {
        return {
          ...cached,
          cached: true,
        };
      }
    }

    const context = await this.dependencies.resolveContextForDiscovery(
      input.threadId,
      cwd ?? undefined,
    );
    const response = await this.sendRequest<Record<string, unknown>>(context, "plugin/list", {
      ...(cwd ? { cwds: [cwd] } : {}),
      ...(input.forceRemoteSync ? { forceRemoteSync: true } : {}),
    });
    const result: ProviderListPluginsResult = {
      ...parsePluginListResponse(response),
      source: "codex-app-server",
      cached: false,
    };
    setRecentCacheEntry(this.pluginsCache, cacheKey, result);
    return result;
  }

  async readPlugin(input: CodexPluginReadInput): Promise<ProviderReadPluginResult> {
    const marketplacePath = input.marketplacePath.trim();
    const pluginName = input.pluginName.trim();
    const cacheKey = JSON.stringify({
      marketplacePath,
      pluginName,
    });
    const cached = getRecentCacheEntry(this.pluginDetailCache, cacheKey);
    if (cached) {
      return {
        ...cached,
        cached: true,
      };
    }

    const context = await this.dependencies.resolveContextForDiscovery(undefined);
    const response = await this.sendRequest<Record<string, unknown>>(context, "plugin/read", {
      marketplacePath,
      pluginName,
    });
    const result: ProviderReadPluginResult = {
      plugin: parsePluginReadResponse(response),
      source: "codex-app-server",
      cached: false,
    };
    setRecentCacheEntry(this.pluginDetailCache, cacheKey, result);
    return result;
  }

  async listModels(threadId?: string): Promise<ProviderListModelsResult> {
    const cacheKey = threadId?.trim() || "__default__";
    const cached = getRecentCacheEntry(this.modelCache, cacheKey);
    if (cached) {
      return {
        ...cached,
        cached: true,
      };
    }

    const context = await this.dependencies.resolveContextForDiscovery(threadId);
    const response = await this.sendRequest<Record<string, unknown>>(context, "model/list", {
      cursor: null,
      limit: 50,
      includeHidden: false,
    });
    const models = parseModelListResponse(response);
    const result: ProviderListModelsResult = {
      models,
      source: "codex-app-server",
      cached: false,
    };
    setRecentCacheEntry(this.modelCache, cacheKey, result);
    return result;
  }

  async transcribeVoice(
    input: ServerVoiceTranscriptionInput,
  ): Promise<ServerVoiceTranscriptionResult> {
    return transcribeVoiceWithChatGptSession({
      request: input,
      resolveAuth: (refreshToken) =>
        this.resolveVoiceTranscriptionAuth({
          cwd: input.cwd,
          ...(input.threadId ? { threadId: input.threadId } : {}),
          refreshToken,
        }),
    });
  }

  getComposerCapabilities(): ProviderComposerCapabilities {
    return {
      provider: "codex",
      supportsSkillMentions: true,
      supportsSkillDiscovery: true,
      supportsNativeSlashCommandDiscovery: false,
      supportsPluginMentions: true,
      supportsPluginDiscovery: true,
      supportsRuntimeModelList: true,
      supportsThreadCompaction: true,
      supportsThreadImport: true,
    };
  }

  async resolveContextForDiscovery(threadId?: string, cwd?: string): Promise<CodexSessionContext> {
    const normalizedThreadId = threadId?.trim();
    const normalizedCwd = cwd?.trim() || undefined;
    if (normalizedThreadId) {
      try {
        const session = this.requireSession(ThreadId.makeUnsafe(normalizedThreadId));
        if (!normalizedCwd || session.session.cwd === normalizedCwd) {
          return session;
        }
      } catch {
        // Discovery is read-only metadata, so if the current draft thread does not
        // have a live Codex session yet we can still service repo-scoped
        // discovery through a dedicated discovery session for that cwd.
      }
    }
    if (normalizedCwd) {
      for (const activeSession of this.sessions.values()) {
        if (
          !activeSession.stopping &&
          !activeSession.child.killed &&
          activeSession.session.cwd === normalizedCwd
        ) {
          return activeSession;
        }
      }
      return this.dependencies.getOrCreateDiscoverySession(normalizedCwd);
    }
    const firstActive = Array.from(this.sessions.values()).find(
      (context) => !context.stopping && !context.child.killed,
    );
    if (firstActive) {
      return firstActive;
    }
    return this.dependencies.getOrCreateDiscoverySession(process.cwd());
  }

  private async resolveVoiceTranscriptionAuth(input: {
    readonly cwd?: string;
    readonly threadId?: string;
    readonly refreshToken: boolean;
  }): Promise<CodexVoiceTranscriptionAuthContext> {
    // Voice transcription should always resolve auth from a fresh discovery context
    // instead of reusing a possibly stale thread-bound session token.
    const context = await this.dependencies.getOrCreateDiscoverySession(
      input.cwd?.trim() || process.cwd(),
    );
    const readAuthStatus = async (refreshToken: boolean) => {
      const response = await this.sendRequest<Record<string, unknown>>(context, "getAuthStatus", {
        includeToken: true,
        refreshToken,
      });
      const authMethod = readString(response, "authMethod");
      return {
        authMethod,
        token: readString(response, "authToken"),
      };
    };

    let { authMethod, token } = await readAuthStatus(input.refreshToken);
    if (!token && !input.refreshToken) {
      ({ authMethod, token } = await readAuthStatus(true));
    }

    if (!token) {
      throw new Error("No ChatGPT session token is available. Sign in to ChatGPT in Codex.");
    }
    if (authMethod !== "chatgpt" && authMethod !== "chatgptAuthTokens") {
      throw new Error("Voice transcription requires a ChatGPT-authenticated Codex session.");
    }

    return {
      authMethod,
      token,
    };
  }

  getOrCreateDiscoverySession(cwd: string): Promise<CodexSessionContext> {
    const normalizedCwd = cwd.trim() || process.cwd();
    return this.lifecycle.runCreation(`discovery:${normalizedCwd}`, (lease) =>
      this.getOrCreateDiscoverySessionInternal(normalizedCwd, lease),
    );
  }

  private async getOrCreateDiscoverySessionInternal(
    normalizedCwd: string,
    lease: CodexManagerCreationLease,
  ): Promise<CodexSessionContext> {
    const existing = this.discoverySessions.get(normalizedCwd);
    if (existing && !existing.stopping && !existing.child.killed) {
      this.scheduleDiscoverySessionIdleStop(normalizedCwd);
      return existing;
    }
    if (existing) {
      await this.stopDiscoverySessionContext(normalizedCwd);
    }

    const now = new Date().toISOString();
    this.dependencies.assertSupportedCodexCliVersion({
      binaryPath: "codex",
      cwd: normalizedCwd,
    });
    lease.assertCurrent();
    const child = spawnCodexAppServer({
      binaryPath: "codex",
      cwd: normalizedCwd,
      env: buildCodexProcessEnv(),
    });
    const output = readline.createInterface({ input: child.stdout });
    const context: CodexSessionContext = {
      session: {
        provider: "codex",
        status: "connecting",
        runtimeMode: "full-access",
        model: CODEX_DEFAULT_MODEL,
        cwd: normalizedCwd,
        threadId: ThreadId.makeUnsafe(`__codex_discovery__:${normalizedCwd}`),
        createdAt: now,
        updatedAt: now,
      },
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
      discovery: true,
    };

    this.discoverySessions.set(normalizedCwd, context);
    this.attachProcessListeners(context);
    try {
      await this.sendRequest(context, "initialize", buildCodexInitializeParams());
      this.writeMessage(context, { method: "initialized" });
      await this.registerAgentGroupSkillsRoot(context);
      lease.assertCurrent();
      try {
        const accountReadResponse = await this.sendRequest(context, "account/read", {});
        context.account = readCodexAccountSnapshot(accountReadResponse);
      } catch {
        // Discovery can still function without account metadata.
      }
      lease.assertCurrent();
      this.updateSession(context, { status: "ready" });
      lease.assertCurrent();
      this.scheduleDiscoverySessionIdleStop(normalizedCwd);
      return context;
    } catch (error) {
      await this.stopDiscoverySessionContext(normalizedCwd);
      throw error;
    }
  }

  private scheduleDiscoverySessionIdleStop(discoveryKey: string): void {
    const existingTimer = this.discoverySessionIdleTimers.get(discoveryKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      const context = this.discoverySessions.get(discoveryKey);
      if (!context || context.stopping) {
        this.discoverySessionIdleTimers.delete(discoveryKey);
        return;
      }
      if (
        context.pending.size > 0 ||
        context.pendingApprovals.size > 0 ||
        context.pendingUserInputs.size > 0
      ) {
        this.scheduleDiscoverySessionIdleStop(discoveryKey);
        return;
      }

      void this.stopDiscoverySession(discoveryKey).catch((error) => {
        log.warn("Failed to stop idle Codex discovery session", { discoveryKey, error });
      });
    }, CODEX_DISCOVERY_SESSION_IDLE_MS);
    timer.unref();
    this.discoverySessionIdleTimers.set(discoveryKey, timer);
  }

  private stopDiscoverySession(discoveryKey: string): Promise<void> {
    return this.lifecycle.runMutation(`discovery:${discoveryKey}`, () =>
      this.stopDiscoverySessionContext(discoveryKey),
    );
  }

  async stopDiscoverySessionContext(discoveryKey: string): Promise<void> {
    const idleTimer = this.discoverySessionIdleTimers.get(discoveryKey);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.discoverySessionIdleTimers.delete(discoveryKey);
    }

    const context = this.discoverySessions.get(discoveryKey);
    if (!context) return;
    return stopCodexSessionContext({
      context,
      teardownProcessTree: this.teardownProcessTree,
      pendingError: new Error("Discovery session stopped before request completed."),
      onExitProven: () => {
        if (this.discoverySessions.get(discoveryKey) === context) {
          this.discoverySessions.delete(discoveryKey);
        }
      },
    });
  }
}
