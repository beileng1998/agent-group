import type { AgentDefinition, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { getAgentMentionAliases, type ProviderSendTurnInput } from "@agent-group/contracts";
import { buildClaudeSubagentPrompt } from "@agent-group/shared/agentMentions";
import {
  applyClaudePromptEffortPrefix,
  getModelCapabilities,
  hasEffortLevel,
  trimOrNull,
} from "@agent-group/shared/model";
import { Effect, FileSystem } from "effect";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import { buildFileAttachmentsPromptBlock } from "./attachmentProjection.ts";
import { toMessage } from "./claudeAdapterErrors.ts";
import { ProviderAdapterRequestError } from "./Errors.ts";
import { withProviderPlanModePrompt } from "./planMode.ts";

const PROVIDER = "claudeAgent" as const;
const SUPPORTED_CLAUDE_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function buildClaudeSdkSubagents(): Record<string, AgentDefinition> {
  const agents: Record<string, AgentDefinition> = {};
  for (const alias of getAgentMentionAliases("claudeAgent")) {
    if (alias.kind !== "claude-subagent" || agents[alias.agentName]) continue;
    agents[alias.agentName] = {
      description: alias.description,
      prompt: alias.prompt,
      ...(alias.tools ? { tools: [...alias.tools] } : {}),
      ...(alias.disallowedTools ? { disallowedTools: [...alias.disallowedTools] } : {}),
      ...(alias.model ? { model: alias.model } : {}),
    };
  }
  return agents;
}

function buildPromptText(input: ProviderSendTurnInput): string {
  const basePrompt = buildClaudeSubagentPrompt(input.input?.trim() ?? "").prompt;
  const rawEffort =
    input.modelSelection?.provider === "claudeAgent" ? input.modelSelection.options?.effort : null;
  const requestedEffort = trimOrNull(rawEffort);
  const claudeModel =
    input.modelSelection?.provider === "claudeAgent" ? input.modelSelection.model : undefined;
  const caps = getModelCapabilities("claudeAgent", claudeModel);
  const promptEffort =
    requestedEffort === "ultrathink" && caps.promptInjectedEffortLevels.includes("ultrathink")
      ? "ultrathink"
      : requestedEffort && hasEffortLevel(caps, requestedEffort)
        ? requestedEffort
        : null;
  return withProviderPlanModePrompt({
    text: applyClaudePromptEffortPrefix(basePrompt, promptEffort),
    interactionMode: input.interactionMode,
  });
}

function buildUserMessage(sdkContent: Array<Record<string, unknown>>): SDKUserMessage {
  return {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: { role: "user", content: sdkContent },
  } as unknown as SDKUserMessage;
}

function buildClaudeImageContentBlock(input: {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}): Record<string, unknown> {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: input.mimeType,
      data: Buffer.from(input.bytes).toString("base64"),
    },
  };
}

export function buildUserMessageEffect(
  input: ProviderSendTurnInput,
  dependencies: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly attachmentsDir: string;
  },
): Effect.Effect<SDKUserMessage, ProviderAdapterRequestError> {
  return Effect.gen(function* () {
    const text = buildPromptText(input);
    const sdkContent: Array<Record<string, unknown>> = [];
    if (text.length > 0) sdkContent.push({ type: "text", text });
    for (const attachment of input.attachments ?? []) {
      if (
        attachment.type !== "image" ||
        !SUPPORTED_CLAUDE_IMAGE_MIME_TYPES.has(attachment.mimeType.toLowerCase())
      ) {
        continue;
      }
      const attachmentPath = resolveAttachmentPath({
        attachmentsDir: dependencies.attachmentsDir,
        attachment,
      });
      if (!attachmentPath) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "turn/start",
          detail: `Invalid attachment id '${attachment.id}'.`,
        });
      }
      const bytes = yield* dependencies.fileSystem.readFile(attachmentPath).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "turn/start",
              detail: toMessage(cause, "Failed to read attachment file."),
              cause,
            }),
        ),
      );
      sdkContent.push(
        buildClaudeImageContentBlock({
          mimeType: attachment.mimeType.toLowerCase(),
          bytes,
        }),
      );
    }
    const fileBlock = buildFileAttachmentsPromptBlock({
      attachments: input.attachments,
      attachmentsDir: dependencies.attachmentsDir,
      include: "all-files",
      includeImage: (attachment) =>
        !SUPPORTED_CLAUDE_IMAGE_MIME_TYPES.has(attachment.mimeType.toLowerCase()),
    });
    if (fileBlock) sdkContent.push({ type: "text", text: fileBlock });
    return buildUserMessage(sdkContent);
  });
}
