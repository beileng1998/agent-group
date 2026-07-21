import type * as EffectAcpSchema from "effect-acp/schema";
import type { RuntimeContentStreamKind, ThreadTokenUsageSnapshot } from "@agent-group/contracts";

import { computeUsagePercent, nonNegativeInteger, positiveInteger } from "../tokenUsage.ts";
import { parseAcpToolCallUpdate, type AcpToolCallState } from "./AcpToolRuntimeModel.ts";

export {
  mergeToolCallState,
  parsePermissionRequest,
  type AcpPermissionRequest,
  type AcpToolCallState,
} from "./AcpToolRuntimeModel.ts";

type AcpTextStreamKind = Extract<RuntimeContentStreamKind, "assistant_text" | "reasoning_text">;

function trimNonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export interface AcpSessionMode {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export interface AcpSessionModeState {
  readonly currentModeId: string;
  readonly availableModes: ReadonlyArray<AcpSessionMode>;
}

export interface AcpPlanUpdate {
  readonly explanation?: string | null;
  readonly plan: ReadonlyArray<{
    readonly step: string;
    readonly status: "pending" | "inProgress" | "completed";
  }>;
}

export type AcpParsedSessionEvent =
  | {
      readonly _tag: "ModeChanged";
      readonly modeId: string;
    }
  | {
      readonly _tag: "AssistantItemStarted";
      readonly itemId: string;
    }
  | {
      readonly _tag: "AssistantItemCompleted";
      readonly itemId: string;
    }
  | {
      readonly _tag: "PlanUpdated";
      readonly payload: AcpPlanUpdate;
      readonly rawPayload: unknown;
    }
  | {
      readonly _tag: "ToolCallUpdated";
      readonly toolCall: AcpToolCallState;
      readonly rawPayload: unknown;
    }
  | {
      readonly _tag: "ContentDelta";
      readonly itemId?: string;
      readonly text: string;
      readonly streamKind?: AcpTextStreamKind;
      readonly rawPayload: unknown;
    }
  | {
      readonly _tag: "UsageUpdated";
      readonly usage: ThreadTokenUsageSnapshot;
      readonly cost?: EffectAcpSchema.Cost | null | undefined;
      readonly rawPayload: unknown;
    };

type AcpSessionSetupResponse =
  | EffectAcpSchema.LoadSessionResponse
  | EffectAcpSchema.NewSessionResponse
  | EffectAcpSchema.ResumeSessionResponse;

export function extractModelConfigId(sessionResponse: AcpSessionSetupResponse): string | undefined {
  const configOptions = sessionResponse.configOptions;
  if (!configOptions) return undefined;
  for (const opt of configOptions) {
    if (opt.category === "model" && opt.id.trim().length > 0) {
      return opt.id.trim();
    }
  }
  return undefined;
}

export function findSessionConfigOption(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
  configId: string,
): EffectAcpSchema.SessionConfigOption | undefined {
  if (!configOptions) {
    return undefined;
  }
  const normalizedConfigId = configId.trim();
  if (!normalizedConfigId) {
    return undefined;
  }
  return configOptions.find((option) => option.id.trim() === normalizedConfigId);
}

export function collectSessionConfigOptionValues(
  configOption: EffectAcpSchema.SessionConfigOption,
): ReadonlyArray<string> {
  if (configOption.type !== "select") {
    return [];
  }
  return configOption.options.flatMap((entry) =>
    "value" in entry ? [entry.value] : entry.options.map((option) => option.value),
  );
}

export function parseSessionModeState(
  sessionResponse: AcpSessionSetupResponse,
): AcpSessionModeState | undefined {
  const modes = sessionResponse.modes;
  if (!modes) return undefined;
  const currentModeId = modes.currentModeId.trim();
  if (!currentModeId) {
    return undefined;
  }
  const availableModes = modes.availableModes
    .map((mode) => {
      const id = mode.id.trim();
      const name = mode.name.trim();
      if (!id || !name) {
        return undefined;
      }
      const description = mode.description?.trim() || undefined;
      return description !== undefined
        ? ({ id, name, description } satisfies AcpSessionMode)
        : ({ id, name } satisfies AcpSessionMode);
    })
    .filter((mode): mode is AcpSessionMode => mode !== undefined);
  if (availableModes.length === 0) {
    return undefined;
  }
  return {
    currentModeId,
    availableModes,
  };
}

function normalizePlanStepStatus(raw: unknown): "pending" | "inProgress" | "completed" {
  switch (raw) {
    case "completed":
      return "completed";
    case "in_progress":
    case "inProgress":
      return "inProgress";
    default:
      return "pending";
  }
}

// Converts ACP's unstable usage updates into Agent Group's context-window snapshot shape.
function tokenUsageSnapshotFromAcpUsageUpdate(input: {
  readonly size: unknown;
  readonly used: unknown;
}): ThreadTokenUsageSnapshot | undefined {
  const usedTokens = nonNegativeInteger(input.used);
  if (usedTokens === undefined) {
    return undefined;
  }
  const maxTokens = positiveInteger(input.size);
  const usedPercent = computeUsagePercent(usedTokens, maxTokens);
  return {
    usedTokens,
    ...(usedPercent !== undefined ? { usedPercent } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    compactsAutomatically: true,
  };
}

export function parseSessionUpdateEvent(params: EffectAcpSchema.SessionNotification): {
  readonly modeId?: string;
  readonly events: ReadonlyArray<AcpParsedSessionEvent>;
} {
  const upd = params.update;
  const events: Array<AcpParsedSessionEvent> = [];
  let modeId: string | undefined;

  switch (upd.sessionUpdate) {
    case "current_mode_update": {
      modeId = upd.currentModeId.trim();
      if (modeId) {
        events.push({
          _tag: "ModeChanged",
          modeId,
        });
      }
      break;
    }
    case "plan": {
      const plan = upd.entries.map((entry, index) => ({
        step: entry.content.trim().length > 0 ? entry.content.trim() : `Step ${index + 1}`,
        status: normalizePlanStepStatus(entry.status),
      }));
      if (plan.length > 0) {
        events.push({
          _tag: "PlanUpdated",
          payload: {
            plan,
          },
          rawPayload: params,
        });
      }
      break;
    }
    case "tool_call": {
      const toolCall = parseAcpToolCallUpdate(upd, {
        fallbackStatus: "pending",
      });
      if (toolCall) {
        events.push({
          _tag: "ToolCallUpdated",
          toolCall,
          rawPayload: params,
        });
      }
      break;
    }
    case "tool_call_update": {
      const toolCall = parseAcpToolCallUpdate(upd);
      if (toolCall) {
        events.push({
          _tag: "ToolCallUpdated",
          toolCall,
          rawPayload: params,
        });
      }
      break;
    }
    case "agent_message_chunk": {
      if (upd.content.type === "text" && upd.content.text.length > 0) {
        const itemId = trimNonEmpty(upd.messageId);
        events.push({
          _tag: "ContentDelta",
          ...(itemId ? { itemId } : {}),
          text: upd.content.text,
          streamKind: "assistant_text",
          rawPayload: params,
        });
      }
      break;
    }
    case "agent_thought_chunk": {
      if (upd.content.type === "text" && upd.content.text.length > 0) {
        const itemId = trimNonEmpty(upd.messageId);
        events.push({
          _tag: "ContentDelta",
          ...(itemId ? { itemId } : {}),
          text: upd.content.text,
          streamKind: "reasoning_text",
          rawPayload: params,
        });
      }
      break;
    }
    case "usage_update": {
      const usage = tokenUsageSnapshotFromAcpUsageUpdate({
        size: upd.size,
        used: upd.used,
      });
      if (usage) {
        events.push({
          _tag: "UsageUpdated",
          usage,
          ...(upd.cost !== undefined ? { cost: upd.cost } : {}),
          rawPayload: params,
        });
      }
      break;
    }
    default:
      break;
  }

  return { ...(modeId !== undefined ? { modeId } : {}), events };
}
