import {
  type ProviderSession,
  type ProviderTurnStartResult,
  ThreadId,
  TurnId,
} from "@agent-group/contracts";

import {
  CODEX_SPARK_MODEL,
  buildCodexCollaborationMode,
  type CodexAppServerSendTurnInput,
  type CodexApprovalPolicy,
  type CodexTurnSandboxPolicy,
  normalizeCodexModelSlug,
  resolveCodexModelForAccount,
  resolveCodexTurnOverrides,
} from "./codexManagerProtocol.ts";
import type { CodexSessionContext } from "./codexSessionContext.ts";
import { readObject, readString } from "./codexJsonValues.ts";
import { readResumeThreadId } from "./codexManagerValues.ts";

export interface CodexTurnControllerDependencies {
  readonly requireSession: (threadId: ThreadId) => CodexSessionContext;
  readonly sendRequest: (
    context: CodexSessionContext,
    method: string,
    params: unknown,
  ) => Promise<unknown>;
  readonly updateSession: (context: CodexSessionContext, updates: Partial<ProviderSession>) => void;
}

export class CodexTurnController {
  constructor(private readonly dependencies: CodexTurnControllerDependencies) {}

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

  private updateSession(context: CodexSessionContext, updates: Partial<ProviderSession>): void {
    this.dependencies.updateSession(context, updates);
  }

  async sendTurn(input: CodexAppServerSendTurnInput): Promise<ProviderTurnStartResult> {
    const context = this.requireSession(input.threadId);
    context.collabReceiverTurns.clear();

    // Normal sends never interrupt active work. The orchestration layer decides
    // when a queued follow-up is ready to become a provider turn.
    const turnInput: Array<
      | { type: "text"; text: string; text_elements: [] }
      | { type: "image"; url: string }
      | { type: "skill"; name: string; path: string }
      | { type: "mention"; name: string; path: string }
    > = [];
    if (input.input) {
      turnInput.push({
        type: "text",
        text: input.input,
        text_elements: [],
      });
    }
    for (const attachment of input.attachments ?? []) {
      if (attachment.type === "image") {
        turnInput.push({
          type: "image",
          url: attachment.url,
        });
      }
    }
    for (const skill of input.skills ?? []) {
      turnInput.push({
        type: "skill",
        name: skill.name,
        path: skill.path,
      });
    }
    for (const mention of input.mentions ?? []) {
      turnInput.push({
        type: "mention",
        name: mention.name,
        path: mention.path,
      });
    }
    if (turnInput.length === 0) {
      throw new Error("Turn input must include text or attachments.");
    }

    const providerThreadId = readResumeThreadId({
      threadId: context.session.threadId,
      runtimeMode: context.session.runtimeMode,
      resumeCursor: context.session.resumeCursor,
    });
    if (!providerThreadId) {
      throw new Error("Session is missing provider resume thread id.");
    }
    const turnStartParams: {
      threadId: string;
      input: Array<
        | { type: "text"; text: string; text_elements: [] }
        | { type: "image"; url: string }
        | { type: "skill"; name: string; path: string }
        | { type: "mention"; name: string; path: string }
      >;
      model?: string;
      serviceTier?: string | null;
      effort?: string;
      summary: "auto" | "none";
      approvalPolicy?: CodexApprovalPolicy;
      sandboxPolicy?: CodexTurnSandboxPolicy;
      collaborationMode?: {
        mode: "default" | "plan";
        settings: {
          model: string;
          reasoning_effort: string;
          developer_instructions: string;
        };
      };
    } = {
      threadId: providerThreadId,
      input: turnInput,
      summary: "auto",
      ...resolveCodexTurnOverrides(context),
    };
    const normalizedModel = resolveCodexModelForAccount(
      normalizeCodexModelSlug(input.model ?? context.session.model),
      context.account,
    );
    if (normalizedModel) {
      turnStartParams.model = normalizedModel;
      if (normalizedModel === CODEX_SPARK_MODEL) {
        turnStartParams.summary = "none";
      }
    }
    if (input.serviceTier !== undefined) {
      turnStartParams.serviceTier = input.serviceTier;
    }
    if (input.effort) {
      turnStartParams.effort = input.effort;
    }
    const collaborationMode = buildCodexCollaborationMode({
      ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
      ...(normalizedModel !== undefined ? { model: normalizedModel } : {}),
      ...(input.effort !== undefined ? { effort: input.effort } : {}),
    });
    if (collaborationMode) {
      if (!turnStartParams.model) {
        turnStartParams.model = collaborationMode.settings.model;
      }
      turnStartParams.collaborationMode = collaborationMode;
    }

    const response = await this.sendRequest(context, "turn/start", turnStartParams);
    const turnIdRaw = readString(readObject(readObject(response), "turn"), "id");
    if (!turnIdRaw) {
      throw new Error("turn/start response did not include a turn id.");
    }
    const turnId = TurnId.makeUnsafe(turnIdRaw);

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

  async steerTurn(input: CodexAppServerSendTurnInput): Promise<ProviderTurnStartResult> {
    const context = this.requireSession(input.threadId);

    const activeTurnId = context.session.activeTurnId;
    if (context.session.status !== "running" || activeTurnId === undefined) {
      return this.sendTurn(input);
    }

    const turnInput: Array<
      | { type: "text"; text: string; text_elements: [] }
      | { type: "image"; url: string }
      | { type: "skill"; name: string; path: string }
      | { type: "mention"; name: string; path: string }
    > = [];
    if (input.input) {
      turnInput.push({
        type: "text",
        text: input.input,
        text_elements: [],
      });
    }
    for (const attachment of input.attachments ?? []) {
      if (attachment.type === "image") {
        turnInput.push({
          type: "image",
          url: attachment.url,
        });
      }
    }
    for (const skill of input.skills ?? []) {
      turnInput.push({
        type: "skill",
        name: skill.name,
        path: skill.path,
      });
    }
    for (const mention of input.mentions ?? []) {
      turnInput.push({
        type: "mention",
        name: mention.name,
        path: mention.path,
      });
    }
    if (turnInput.length === 0) {
      throw new Error("Turn input must include text or attachments.");
    }

    const providerThreadId = readResumeThreadId({
      threadId: context.session.threadId,
      runtimeMode: context.session.runtimeMode,
      resumeCursor: context.session.resumeCursor,
    });
    if (!providerThreadId) {
      throw new Error("Session is missing provider resume thread id.");
    }

    const response = await this.sendRequest(context, "turn/steer", {
      threadId: providerThreadId,
      input: turnInput,
      expectedTurnId: activeTurnId,
    });

    const turnIdRaw = readString(readObject(response), "turnId");
    if (!turnIdRaw) {
      throw new Error("turn/steer response did not include a turn id.");
    }
    const turnId = TurnId.makeUnsafe(turnIdRaw);

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
}
