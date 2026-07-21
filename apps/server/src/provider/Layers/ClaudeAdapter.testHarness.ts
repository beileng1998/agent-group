import * as NodeServices from "@effect/platform-node/NodeServices";
import type {
  ModelInfo,
  Options as ClaudeQueryOptions,
  PermissionMode,
  SDKControlGetContextUsageResponse,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { Layer } from "effect";

import { ServerConfig } from "../../config.ts";
import { makeClaudeAdapterLive, type ClaudeAdapterLiveOptions } from "./ClaudeAdapter.ts";

export class FakeClaudeQuery implements AsyncIterable<SDKMessage> {
  private readonly queue: Array<SDKMessage> = [];
  private readonly waiters: Array<{
    readonly resolve: (value: IteratorResult<SDKMessage>) => void;
    readonly reject: (reason: unknown) => void;
  }> = [];
  private done = false;
  private failure: unknown | undefined;

  readonly interruptCalls: Array<void> = [];
  readonly stopTaskCalls: string[] = [];
  readonly setModelCalls: Array<string | undefined> = [];
  readonly setPermissionModeCalls: string[] = [];
  readonly setMaxThinkingTokensCalls: Array<number | null> = [];
  readonly applyFlagSettingsCalls: Array<Record<string, unknown>> = [];
  getContextUsageCalls = 0;
  private contextUsageResponse: SDKControlGetContextUsageResponse | undefined;
  private contextUsageNeverResolves = false;
  private supportedModelList: ModelInfo[] = [];
  closeCalls = 0;

  emit(message: SDKMessage): void {
    if (this.done) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value: message });
      return;
    }
    this.queue.push(message);
  }

  fail(cause: unknown): void {
    if (this.done) return;
    this.done = true;
    this.failure = cause;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(cause);
    }
  }

  finish(): void {
    if (this.done) return;
    this.done = true;
    this.failure = undefined;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ done: true, value: undefined });
    }
  }

  readonly interrupt = async (): Promise<void> => {
    this.interruptCalls.push(undefined);
  };

  readonly stopTask = async (taskId: string): Promise<void> => {
    this.stopTaskCalls.push(taskId);
  };

  readonly setModel = async (model?: string): Promise<void> => {
    this.setModelCalls.push(model);
  };

  readonly setPermissionMode = async (mode: PermissionMode): Promise<void> => {
    this.setPermissionModeCalls.push(mode);
  };

  readonly setMaxThinkingTokens = async (maxThinkingTokens: number | null): Promise<void> => {
    this.setMaxThinkingTokensCalls.push(maxThinkingTokens);
  };

  readonly applyFlagSettings = async (settings: Record<string, unknown>): Promise<void> => {
    this.applyFlagSettingsCalls.push(settings);
  };

  setContextUsageResponse(response: SDKControlGetContextUsageResponse): void {
    this.contextUsageResponse = response;
  }

  setContextUsageNeverResolves(): void {
    this.contextUsageNeverResolves = true;
  }

  readonly getContextUsage = async (): Promise<SDKControlGetContextUsageResponse> => {
    this.getContextUsageCalls += 1;
    if (this.contextUsageNeverResolves) {
      return new Promise<SDKControlGetContextUsageResponse>(() => {});
    }
    if (!this.contextUsageResponse) {
      throw new Error("Context usage unavailable in this test.");
    }
    return this.contextUsageResponse;
  };

  readonly supportedCommands = async (): Promise<
    Array<{ name: string; description: string; argumentHint: string }>
  > => [];

  setSupportedModels(models: ModelInfo[]): void {
    this.supportedModelList = models;
  }

  readonly supportedModels = async (): Promise<ModelInfo[]> => this.supportedModelList;
  readonly supportedAgents = async (): Promise<[]> => [];

  readonly close = (): void => {
    this.closeCalls += 1;
    this.finish();
  };

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: () => {
        const value = this.queue.shift();
        if (value) return Promise.resolve({ done: false, value });
        if (this.failure !== undefined) {
          const failure = this.failure;
          this.failure = undefined;
          return Promise.reject(failure);
        }
        if (this.done) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      },
    };
  }
}

export function makeClaudeAdapterTestHarness(config?: {
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: ClaudeAdapterLiveOptions["nativeEventLogger"];
  readonly cwd?: string;
  readonly baseDir?: string;
}) {
  const query = new FakeClaudeQuery();
  let createInput:
    | {
        readonly prompt: AsyncIterable<SDKUserMessage>;
        readonly options: ClaudeQueryOptions;
      }
    | undefined;

  const adapterOptions: ClaudeAdapterLiveOptions = {
    createQuery: (input) => {
      createInput = input;
      return query;
    },
    ...(config?.nativeEventLogger ? { nativeEventLogger: config.nativeEventLogger } : {}),
    ...(config?.nativeEventLogPath ? { nativeEventLogPath: config.nativeEventLogPath } : {}),
  };

  return {
    layer: makeClaudeAdapterLive(adapterOptions).pipe(
      Layer.provideMerge(
        ServerConfig.layerTest(
          config?.cwd ?? "/tmp/claude-adapter-test",
          config?.baseDir ?? "/tmp",
        ),
      ),
      Layer.provideMerge(NodeServices.layer),
    ),
    query,
    getLastCreateQueryInput: () => createInput,
  };
}

export function makeMultiQueryClaudeAdapterTestHarness(config?: {
  readonly failCreateAt?: number;
}) {
  const queries: FakeClaudeQuery[] = [];
  const createInputs: Array<{
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: ClaudeQueryOptions;
  }> = [];
  const layer = makeClaudeAdapterLive({
    createQuery: (input) => {
      if (queries.length === config?.failCreateAt) {
        throw new Error("simulated Claude spawn failure");
      }
      const query = new FakeClaudeQuery();
      queries.push(query);
      createInputs.push(input);
      return query;
    },
  }).pipe(
    Layer.provideMerge(ServerConfig.layerTest("/tmp/claude-adapter-test", "/tmp")),
    Layer.provideMerge(NodeServices.layer),
  );

  return { layer, queries, createInputs };
}
