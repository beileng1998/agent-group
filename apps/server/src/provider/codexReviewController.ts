import { randomUUID } from "node:crypto";

import {
  EventId,
  type ProviderEvent,
  type ProviderSession,
  type ProviderStartReviewInput,
  type ProviderTurnStartResult,
  ThreadId,
  TurnId,
} from "@agent-group/contracts";

import {
  type CodexAppServerReviewTarget,
  type CodexThreadSnapshot,
  log,
} from "./codexManagerProtocol.ts";
import type { CodexSessionContext } from "./codexSessionContext.ts";
import { readObject, readString } from "./codexJsonValues.ts";
import { readResumeThreadId } from "./codexManagerValues.ts";
import {
  findLatestReviewTurnId,
  isExitedReviewTurn,
  isTurnInterruptTimeout,
} from "./codexReviewValues.ts";

export interface CodexReviewControllerDependencies {
  readonly requireSession: (threadId: ThreadId) => CodexSessionContext;
  readonly sendRequest: (
    context: CodexSessionContext,
    method: string,
    params: unknown,
  ) => Promise<unknown>;
  readonly readThread: (threadId: ThreadId) => Promise<CodexThreadSnapshot>;
  readonly updateSession: (context: CodexSessionContext, updates: Partial<ProviderSession>) => void;
  readonly emitEvent: (event: ProviderEvent) => void;
}

export class CodexReviewController {
  constructor(private readonly dependencies: CodexReviewControllerDependencies) {}

  private requireSession(threadId: ThreadId): CodexSessionContext {
    return this.dependencies.requireSession(threadId);
  }

  private sendRequest(
    context: CodexSessionContext,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    return this.dependencies.sendRequest(context, method, params);
  }

  private readThread(threadId: ThreadId): Promise<CodexThreadSnapshot> {
    return this.dependencies.readThread(threadId);
  }

  private updateSession(context: CodexSessionContext, updates: Partial<ProviderSession>): void {
    this.dependencies.updateSession(context, updates);
  }

  private emitEvent(event: ProviderEvent): void {
    this.dependencies.emitEvent(event);
  }

  async startReview(input: ProviderStartReviewInput): Promise<ProviderTurnStartResult> {
    const context = this.requireSession(input.threadId);
    const providerThreadId = readResumeThreadId({
      threadId: context.session.threadId,
      runtimeMode: context.session.runtimeMode,
      resumeCursor: context.session.resumeCursor,
    });
    if (!providerThreadId) {
      throw new Error("Session is missing a provider resume thread id.");
    }

    const response = await this.sendRequest(context, "review/start", {
      threadId: providerThreadId,
      delivery: "inline",
      target: this.toCodexReviewTarget(input.target),
    });

    const turn = readObject(readObject(response), "turn");
    const turnIdRaw = readString(turn, "id");
    if (!turnIdRaw) {
      throw new Error("review/start response did not include a turn id.");
    }
    const turnId = TurnId.makeUnsafe(turnIdRaw);
    context.reviewTurnIds.add(turnId);
    log.info("[codex-review] review/start acknowledged", {
      threadId: context.session.threadId,
      providerThreadId,
      turnId,
      target: input.target.type,
    });

    this.updateSession(context, {
      status: "running",
      activeTurnId: turnId,
      ...(context.session.resumeCursor !== undefined
        ? { resumeCursor: context.session.resumeCursor }
        : {}),
    });

    return {
      threadId: context.session.threadId,
      turnId,
      ...(context.session.resumeCursor !== undefined
        ? { resumeCursor: context.session.resumeCursor }
        : {}),
    };
  }

  async interruptTurn(
    threadId: ThreadId,
    turnId?: TurnId,
    providerThreadIdOverride?: string,
  ): Promise<void> {
    const context = this.requireSession(threadId);
    const effectiveTurnId = turnId ?? context.session.activeTurnId;

    const providerThreadId =
      providerThreadIdOverride ??
      readResumeThreadId({
        threadId: context.session.threadId,
        runtimeMode: context.session.runtimeMode,
        resumeCursor: context.session.resumeCursor,
      });
    if (!effectiveTurnId || !providerThreadId) {
      log.info("[codex-review] turn/interrupt skipped", {
        threadId,
        requestedTurnId: turnId ?? null,
        activeTurnId: context.session.activeTurnId ?? null,
        providerThreadId: providerThreadId ?? null,
      });
      return;
    }

    log.info("[codex-review] turn/interrupt requested", {
      threadId,
      providerThreadId,
      turnId: effectiveTurnId,
      isTrackedReviewTurn: context.reviewTurnIds.has(effectiveTurnId),
    });
    try {
      await this.sendRequest(context, "turn/interrupt", {
        threadId: providerThreadId,
        turnId: effectiveTurnId,
      });
      log.info("[codex-review] turn/interrupt acknowledged", {
        threadId,
        providerThreadId,
        turnId: effectiveTurnId,
      });
    } catch (error) {
      log.warn("[codex-review] turn/interrupt failed", {
        threadId,
        providerThreadId,
        turnId: effectiveTurnId,
        isTrackedReviewTurn: context.reviewTurnIds.has(effectiveTurnId),
        error: error instanceof Error ? error.message : String(error),
      });
      if (!context.reviewTurnIds.has(effectiveTurnId) || !isTurnInterruptTimeout(error)) {
        throw error;
      }

      const snapshot = await this.readThread(threadId);
      const latestReviewTurnId = findLatestReviewTurnId(snapshot);
      log.info("[codex-review] review interrupt recovery snapshot", {
        threadId,
        currentTurnId: effectiveTurnId,
        latestReviewTurnId: latestReviewTurnId ?? null,
        latestReviewTurnExited: latestReviewTurnId
          ? isExitedReviewTurn(snapshot, latestReviewTurnId)
          : false,
        snapshotTurnIds: snapshot.turns.map((turn) => String(turn.id)),
      });

      if (latestReviewTurnId && isExitedReviewTurn(snapshot, latestReviewTurnId)) {
        log.info("[codex-review] settling review from thread/read exitedReviewMode", {
          threadId,
          turnId: latestReviewTurnId,
        });
        this.settleTrackedReview(context, {
          completedTurnId: latestReviewTurnId,
          reason: "review exited via thread/read",
        });
        return;
      }

      if (latestReviewTurnId && latestReviewTurnId !== effectiveTurnId) {
        log.info("[codex-review] retrying turn/interrupt with refreshed review turn", {
          threadId,
          previousTurnId: effectiveTurnId,
          nextTurnId: latestReviewTurnId,
        });
        await this.sendRequest(context, "turn/interrupt", {
          threadId: providerThreadId,
          turnId: latestReviewTurnId,
        });
        context.reviewTurnIds.add(latestReviewTurnId);
        this.updateSession(context, {
          activeTurnId: latestReviewTurnId,
        });
        return;
      }

      throw error;
    }
  }

  settleTrackedReview(
    context: CodexSessionContext,
    input: {
      readonly completedTurnId?: TurnId;
      readonly reason: string;
    },
  ): void {
    const terminalTurnId =
      context.session.activeTurnId !== undefined &&
      context.reviewTurnIds.has(context.session.activeTurnId)
        ? context.session.activeTurnId
        : input.completedTurnId !== undefined && context.reviewTurnIds.has(input.completedTurnId)
          ? input.completedTurnId
          : context.reviewTurnIds.values().next().value;

    this.updateSession(context, {
      status: "ready",
      activeTurnId: undefined,
      lastError: undefined,
    });

    context.reviewTurnIds.clear();

    if (!terminalTurnId) {
      return;
    }

    this.emitEvent({
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: "codex",
      threadId: context.session.threadId,
      createdAt: new Date().toISOString(),
      method: "turn/completed",
      turnId: terminalTurnId,
      message: input.reason,
      payload: {
        turn: {
          id: terminalTurnId,
          status: "completed",
        },
      },
    });
  }

  private toCodexReviewTarget(target: CodexAppServerReviewTarget): Record<string, unknown> {
    switch (target.type) {
      case "uncommittedChanges":
        return {
          type: "uncommittedChanges",
        };
      case "baseBranch":
        return {
          type: "baseBranch",
          branch: target.branch,
        };
    }
  }
}
