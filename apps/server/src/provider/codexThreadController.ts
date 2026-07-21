import { randomUUID } from "node:crypto";

import {
  EventId,
  type ProviderEvent,
  type ProviderSession,
  ThreadId,
  TurnId,
} from "@agent-group/contracts";
import { Effect } from "effect";

import type { CodexThreadSnapshot } from "./codexManagerProtocol.ts";
import type { CodexSessionContext } from "./codexSessionContext.ts";
import { readArray, readObject, readString } from "./codexJsonValues.ts";
import { readResumeThreadId, toTurnId } from "./codexManagerValues.ts";

export interface CodexThreadControllerDependencies {
  readonly requireSession: (threadId: ThreadId) => CodexSessionContext;
  readonly resolveContextForDiscovery: (
    threadId: string | undefined,
    cwd: string | undefined,
  ) => Promise<CodexSessionContext>;
  readonly sendRequest: (
    context: CodexSessionContext,
    method: string,
    params: unknown,
  ) => Promise<unknown>;
  readonly updateSession: (context: CodexSessionContext, updates: Partial<ProviderSession>) => void;
  readonly emitEvent: (event: ProviderEvent) => void;
  readonly runPromise: (effect: Effect.Effect<unknown, never>) => Promise<unknown>;
}

export class CodexThreadController {
  constructor(private readonly dependencies: CodexThreadControllerDependencies) {}

  private requireSession(threadId: ThreadId): CodexSessionContext {
    return this.dependencies.requireSession(threadId);
  }

  private resolveContextForDiscovery(
    threadId: string | undefined,
    cwd: string | undefined,
  ): Promise<CodexSessionContext> {
    return this.dependencies.resolveContextForDiscovery(threadId, cwd);
  }

  private sendRequest(
    context: CodexSessionContext,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    return this.dependencies.sendRequest(context, method, params);
  }

  private updateSession(context: CodexSessionContext, updates: Partial<ProviderSession>): void {
    this.dependencies.updateSession(context, updates);
  }

  private emitEvent(event: ProviderEvent): void {
    this.dependencies.emitEvent(event);
  }

  private get runPromise() {
    return this.dependencies.runPromise;
  }

  async readThread(threadId: ThreadId): Promise<CodexThreadSnapshot> {
    const context = this.requireSession(threadId);
    const providerThreadId = readResumeThreadId({
      threadId: context.session.threadId,
      runtimeMode: context.session.runtimeMode,
      resumeCursor: context.session.resumeCursor,
    });
    if (!providerThreadId) {
      throw new Error("Session is missing a provider resume thread id.");
    }

    const response = await this.sendRequest(context, "thread/read", {
      threadId: providerThreadId,
      includeTurns: true,
    });
    return this.parseThreadSnapshot("thread/read", response);
  }

  async readExternalThread(input: {
    externalThreadId: string;
    cwd?: string;
  }): Promise<CodexThreadSnapshot> {
    const context = await this.resolveContextForDiscovery(undefined, input.cwd);
    const response = await this.sendRequest(context, "thread/read", {
      threadId: input.externalThreadId,
      includeTurns: true,
    });
    return this.parseThreadSnapshot("thread/read", response);
  }

  async rollbackThread(threadId: ThreadId, numTurns: number): Promise<CodexThreadSnapshot> {
    const context = this.requireSession(threadId);
    const providerThreadId = readResumeThreadId({
      threadId: context.session.threadId,
      runtimeMode: context.session.runtimeMode,
      resumeCursor: context.session.resumeCursor,
    });
    if (!providerThreadId) {
      throw new Error("Session is missing a provider resume thread id.");
    }
    if (!Number.isInteger(numTurns) || numTurns < 1) {
      throw new Error("numTurns must be an integer >= 1.");
    }

    const response = await this.sendRequest(context, "thread/rollback", {
      threadId: providerThreadId,
      numTurns,
    });
    this.updateSession(context, {
      status: "ready",
      activeTurnId: undefined,
    });
    return this.parseThreadSnapshot("thread/rollback", response);
  }

  async compactThread(threadId: ThreadId): Promise<void> {
    const context = this.requireSession(threadId);
    const providerThreadId = readResumeThreadId({
      threadId: context.session.threadId,
      runtimeMode: context.session.runtimeMode,
      resumeCursor: context.session.resumeCursor,
    });
    if (!providerThreadId) {
      throw new Error("Session is missing a provider resume thread id.");
    }

    await Effect.logInfo("codex app-server compact requested", {
      threadId: context.session.threadId,
      providerThreadId,
      runtimeMode: context.session.runtimeMode,
      activeTurnId: context.session.activeTurnId ?? null,
    }).pipe(this.runPromise);

    this.updateSession(context, {
      status: "running",
    });
    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: "codex",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      ...(context.session.activeTurnId ? { turnId: context.session.activeTurnId } : {}),
      method: "thread/compacting",
      message: "Compacting context",
      payload: {
        threadId: providerThreadId,
        state: "compacting",
      },
    });
    try {
      await this.sendRequest(context, "thread/compact/start", {
        threadId: providerThreadId,
      });
      await Effect.logInfo("codex app-server compact start acknowledged", {
        threadId: context.session.threadId,
        providerThreadId,
      }).pipe(this.runPromise);
    } catch (error) {
      this.updateSession(context, {
        status: "error",
        lastError: error instanceof Error ? error.message : context.session.lastError,
      });
      await Effect.logWarning("codex app-server compact failed", {
        threadId: context.session.threadId,
        providerThreadId,
        cause: error,
      }).pipe(this.runPromise);
      throw error;
    }
  }

  private parseThreadSnapshot(method: string, response: unknown): CodexThreadSnapshot {
    const responseRecord = readObject(response);
    const threadRecord = readObject(responseRecord, "thread");
    const threadIdRaw = this.readThreadIdFromResponse(method, responseRecord);
    const turnsRaw = readArray(threadRecord, "turns") ?? readArray(responseRecord, "turns") ?? [];
    const turns = turnsRaw.map((turnValue, index) => {
      const turn = readObject(turnValue);
      const turnIdRaw = readString(turn, "id") ?? `${threadIdRaw}:turn:${index + 1}`;
      const turnId = TurnId.makeUnsafe(turnIdRaw);
      const items = readArray(turn, "items") ?? [];
      return {
        id: turnId,
        items,
      };
    });

    return {
      threadId: threadIdRaw,
      turns,
      cwd: readString(threadRecord, "cwd") ?? readString(responseRecord, "cwd") ?? null,
    };
  }

  readThreadIdFromResponse(method: string, response: unknown): string {
    const responseRecord = readObject(response);
    const thread = readObject(responseRecord, "thread");
    const threadIdRaw = readString(thread, "id") ?? readString(responseRecord, "threadId");
    if (!threadIdRaw) {
      throw new Error(`${method} response did not include a thread id.`);
    }
    return threadIdRaw;
  }
}
