import type {
  ParsedSubagentAgentState,
  ParsedSubagentIdentityHint,
  ParsedSubagentReceiverAgent,
} from "./types";
import {
  asArray,
  asRecord,
  asTrimmedString,
  firstStringValue,
  pushUniqueThreadId,
} from "./payloadValues";

export function extractSubagentIdentityFromSource(
  item: Record<string, unknown>,
): ParsedSubagentIdentityHint | null {
  const source = asRecord(item.source);
  const subagent =
    asRecord(source?.subAgent) ?? asRecord(source?.sub_agent) ?? asRecord(item.subAgent);
  const threadSpawn = asRecord(subagent?.thread_spawn) ?? asRecord(subagent?.threadSpawn);
  const providerThreadId =
    asTrimmedString(
      item.threadId ??
        item.thread_id ??
        item.conversationId ??
        item.conversation_id ??
        item.receiverThreadId ??
        item.receiver_thread_id,
    ) ?? firstStringValue(threadSpawn, ["threadId", "thread_id"]);
  const agentId =
    asTrimmedString(item.agentId ?? item.agent_id ?? item.id) ??
    firstStringValue(threadSpawn, ["agentId", "agent_id", "id"]) ??
    firstStringValue(subagent, ["agentId", "agent_id", "id"]);
  const nickname =
    firstStringValue(item, ["agentNickname", "agent_nickname", "nickname"]) ??
    firstStringValue(threadSpawn, ["agentNickname", "agent_nickname", "nickname", "name"]) ??
    firstStringValue(subagent, ["agentNickname", "agent_nickname", "nickname", "name"]);
  const role =
    firstStringValue(item, ["agentRole", "agent_role", "agentType", "agent_type"]) ??
    firstStringValue(threadSpawn, ["agentRole", "agent_role", "agentType", "agent_type"]) ??
    firstStringValue(subagent, ["agentRole", "agent_role", "agentType", "agent_type"]);

  if (!providerThreadId && !agentId && !nickname && !role) {
    return null;
  }

  return {
    ...(providerThreadId ? { providerThreadId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(nickname ? { nickname } : {}),
    ...(role ? { role } : {}),
  };
}

export function normalizeSubagentIdentifier(value: unknown): string | undefined {
  return asTrimmedString(value);
}

export function decodeSubagentReceiverThreadIds(
  item: Record<string, unknown> | null | undefined,
): ReadonlyArray<string> {
  if (!item) {
    return [];
  }
  const plural = ["receiverThreadIds", "receiver_thread_ids", "threadIds", "thread_ids"] as const;
  for (const key of plural) {
    const values = asArray(item[key]);
    if (!values) {
      continue;
    }
    const threadIds = values
      .map((value) => normalizeSubagentIdentifier(value))
      .filter((value): value is string => value !== undefined);
    if (threadIds.length > 0) {
      return threadIds;
    }
  }

  const singular = firstStringValue(item, [
    "receiverThreadId",
    "receiver_thread_id",
    "threadId",
    "thread_id",
    "newThreadId",
    "new_thread_id",
  ]);
  return singular ? [singular] : [];
}

export function decodeSubagentReceiverAgents(
  item: Record<string, unknown>,
  fallbackThreadIds: ReadonlyArray<string>,
): ReadonlyArray<ParsedSubagentReceiverAgent> {
  const topLevelModel = firstStringValue(item, [
    "model",
    "modelName",
    "model_name",
    "requestedModel",
    "requested_model",
  ]);
  const topLevelPrompt = firstStringValue(item, ["prompt", "task", "message"]);
  const agentsValue =
    asArray(item.receiverAgents) ?? asArray(item.receiver_agents) ?? asArray(item.agents);
  const decodedAgents =
    agentsValue?.flatMap((entry, index) => {
      const object = asRecord(entry);
      if (!object) {
        return [];
      }

      const providerThreadId =
        firstStringValue(object, [
          "threadId",
          "thread_id",
          "receiverThreadId",
          "receiver_thread_id",
          "newThreadId",
          "new_thread_id",
        ]) ??
        fallbackThreadIds[index] ??
        undefined;
      if (!providerThreadId) {
        return [];
      }

      const agentId = firstStringValue(object, [
        "agentId",
        "agent_id",
        "receiverAgentId",
        "receiver_agent_id",
        "newAgentId",
        "new_agent_id",
        "id",
      ]);
      const nickname = firstStringValue(object, [
        "agentNickname",
        "agent_nickname",
        "receiverAgentNickname",
        "receiver_agent_nickname",
        "newAgentNickname",
        "new_agent_nickname",
        "nickname",
        "name",
      ]);
      const role = firstStringValue(object, [
        "agentRole",
        "agent_role",
        "receiverAgentRole",
        "receiver_agent_role",
        "newAgentRole",
        "new_agent_role",
        "agentType",
        "agent_type",
      ]);
      const directModel = firstStringValue(object, ["model", "modelName", "model_name"]);
      const requestedModel = firstStringValue(object, ["requestedModel", "requested_model"]);
      const model = directModel ?? requestedModel ?? topLevelModel;
      const prompt = firstStringValue(object, ["prompt", "task", "message"]) ?? topLevelPrompt;

      return [
        {
          providerThreadId,
          ...(agentId ? { agentId } : {}),
          ...(nickname ? { nickname } : {}),
          ...(role ? { role } : {}),
          ...(model ? { model } : {}),
          ...(prompt ? { prompt } : {}),
          ...(model && !directModel ? { modelIsRequestedHint: true } : {}),
        },
      ];
    }) ?? [];

  if (decodedAgents.length > 0) {
    return decodedAgents;
  }

  const providerThreadId = fallbackThreadIds[0];
  if (!providerThreadId) {
    return [];
  }

  const agentId = firstStringValue(item, ["newAgentId", "new_agent_id", "agentId", "agent_id"]);
  const nickname = firstStringValue(item, [
    "newAgentNickname",
    "new_agent_nickname",
    "agentNickname",
    "agent_nickname",
    "receiverAgentNickname",
    "receiver_agent_nickname",
  ]);
  const role = firstStringValue(item, [
    "receiverAgentRole",
    "receiver_agent_role",
    "newAgentRole",
    "new_agent_role",
    "agentRole",
    "agent_role",
    "agentType",
    "agent_type",
  ]);

  return [
    {
      providerThreadId,
      ...(agentId ? { agentId } : {}),
      ...(nickname ? { nickname } : {}),
      ...(role ? { role } : {}),
      ...(topLevelModel ? { model: topLevelModel, modelIsRequestedHint: true } : {}),
      ...(topLevelPrompt ? { prompt: topLevelPrompt } : {}),
    },
  ];
}

function buildSubagentAgentState(
  threadId: string,
  object: Record<string, unknown> | null,
): ParsedSubagentAgentState {
  return {
    threadId,
    ...(firstStringValue(object, ["agentId", "agent_id"])
      ? { agentId: firstStringValue(object, ["agentId", "agent_id"]) }
      : {}),
    ...(firstStringValue(object, [
      "agentNickname",
      "agent_nickname",
      "receiverAgentNickname",
      "receiver_agent_nickname",
    ])
      ? {
          nickname: firstStringValue(object, [
            "agentNickname",
            "agent_nickname",
            "receiverAgentNickname",
            "receiver_agent_nickname",
          ]),
        }
      : {}),
    ...(firstStringValue(object, [
      "agentRole",
      "agent_role",
      "receiverAgentRole",
      "receiver_agent_role",
      "agentType",
      "agent_type",
    ])
      ? {
          role: firstStringValue(object, [
            "agentRole",
            "agent_role",
            "receiverAgentRole",
            "receiver_agent_role",
            "agentType",
            "agent_type",
          ]),
        }
      : {}),
    ...(firstStringValue(object, [
      "model",
      "modelName",
      "model_name",
      "requestedModel",
      "requested_model",
    ])
      ? {
          model: firstStringValue(object, [
            "model",
            "modelName",
            "model_name",
            "requestedModel",
            "requested_model",
          ]),
        }
      : {}),
    ...(firstStringValue(object, ["prompt", "task", "message"])
      ? { prompt: firstStringValue(object, ["prompt", "task", "message"]) }
      : {}),
    ...(firstStringValue(object, ["status", "state"])
      ? { status: firstStringValue(object, ["status", "state"]) }
      : {}),
    ...(firstStringValue(object, ["summary", "message", "latestUpdate", "latest_update"])
      ? {
          message: firstStringValue(object, [
            "summary",
            "message",
            "latestUpdate",
            "latest_update",
          ]),
        }
      : {}),
  };
}

export function decodeSubagentAgentStates(
  item: Record<string, unknown> | null | undefined,
): Record<string, ParsedSubagentAgentState> {
  const candidate =
    asRecord(item?.statuses) ??
    asRecord(item?.agentsStates) ??
    asRecord(item?.agents_states) ??
    asRecord(item?.agentStates) ??
    asRecord(item?.agent_states);
  if (candidate) {
    const decoded: Record<string, ParsedSubagentAgentState> = {};
    for (const [rawThreadId, rawValue] of Object.entries(candidate)) {
      const object = asRecord(rawValue);
      const threadId =
        asTrimmedString(rawThreadId) ?? firstStringValue(object, ["threadId", "thread_id"]);
      if (!threadId) {
        continue;
      }
      decoded[threadId] = buildSubagentAgentState(threadId, object);
    }
    return decoded;
  }

  const values =
    asArray(item?.agentStatuses) ?? asArray(item?.agent_statuses) ?? asArray(item?.statuses);
  if (!values) {
    return {};
  }

  const decoded: Record<string, ParsedSubagentAgentState> = {};
  for (const rawValue of values) {
    const object = asRecord(rawValue);
    const threadId = firstStringValue(object, ["threadId", "thread_id"]);
    if (!threadId) {
      continue;
    }
    decoded[threadId] = buildSubagentAgentState(threadId, object);
  }
  return decoded;
}

export function collectSubagentProviderThreadIds(
  item: Record<string, unknown>,
): ReadonlyArray<string> {
  const orderedThreadIds: string[] = [];
  const seen = new Set<string>();

  for (const threadId of decodeSubagentReceiverThreadIds(item)) {
    pushUniqueThreadId(orderedThreadIds, seen, threadId);
  }
  for (const agent of decodeSubagentReceiverAgents(item, orderedThreadIds)) {
    pushUniqueThreadId(orderedThreadIds, seen, agent.providerThreadId);
  }
  for (const threadId of Object.keys(decodeSubagentAgentStates(item))) {
    pushUniqueThreadId(orderedThreadIds, seen, threadId);
  }

  const sourceIdentity = extractSubagentIdentityFromSource(item);
  pushUniqueThreadId(orderedThreadIds, seen, sourceIdentity?.providerThreadId);

  pushUniqueThreadId(
    orderedThreadIds,
    seen,
    firstStringValue(item, [
      "newThreadId",
      "new_thread_id",
      "receiverThreadId",
      "receiver_thread_id",
    ]),
  );

  return orderedThreadIds;
}
