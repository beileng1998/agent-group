import {
  decodeSubagentAgentStates,
  decodeSubagentReceiverAgents,
  decodeSubagentReceiverThreadIds,
  extractSubagentIdentityFromSource,
} from "./payloadDecoding";
import { asTrimmedString, firstStringValue } from "./payloadValues";
import type { ParsedSubagentIdentityDirectory, ParsedSubagentIdentityHint } from "./types";

export function extractSubagentIdentityHints(
  item: Record<string, unknown>,
): ReadonlyArray<ParsedSubagentIdentityHint> {
  const hints: ParsedSubagentIdentityHint[] = [];
  const seen = new Set<string>();

  const pushHint = (hint: ParsedSubagentIdentityHint | null | undefined) => {
    if (!hint) {
      return;
    }
    const key = [
      hint.providerThreadId ?? "",
      hint.agentId ?? "",
      hint.nickname ?? "",
      hint.role ?? "",
      hint.model ?? "",
      hint.prompt ?? "",
      hint.status ?? "",
      hint.message ?? "",
      hint.modelIsRequestedHint ? "1" : "0",
    ].join("\u0001");
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    hints.push(hint);
  };

  pushHint(extractSubagentIdentityFromSource(item));
  pushHint({
    providerThreadId: firstStringValue(item, [
      "newThreadId",
      "new_thread_id",
      "receiverThreadId",
      "receiver_thread_id",
      "threadId",
      "thread_id",
    ]),
    agentId: firstStringValue(item, [
      "newAgentId",
      "new_agent_id",
      "receiverAgentId",
      "receiver_agent_id",
      "agentId",
      "agent_id",
    ]),
    nickname: firstStringValue(item, [
      "newAgentNickname",
      "new_agent_nickname",
      "receiverAgentNickname",
      "receiver_agent_nickname",
      "agentNickname",
      "agent_nickname",
      "nickname",
    ]),
    role: firstStringValue(item, [
      "newAgentRole",
      "new_agent_role",
      "receiverAgentRole",
      "receiver_agent_role",
      "agentRole",
      "agent_role",
      "agentType",
      "agent_type",
    ]),
  });

  const receiverThreadIds = decodeSubagentReceiverThreadIds(item);
  for (const receiverAgent of decodeSubagentReceiverAgents(item, receiverThreadIds)) {
    pushHint(receiverAgent);
  }

  for (const state of Object.values(decodeSubagentAgentStates(item))) {
    pushHint({
      providerThreadId: state.threadId,
      agentId: state.agentId,
      nickname: state.nickname,
      role: state.role,
      model: state.model,
      prompt: state.prompt,
      status: state.status,
      message: state.message,
    });
  }

  return hints.filter(
    (hint) =>
      hint.providerThreadId !== undefined ||
      hint.agentId !== undefined ||
      hint.nickname !== undefined ||
      hint.role !== undefined,
  );
}

function selectMergedModel(input: {
  existing: ParsedSubagentIdentityHint | undefined;
  incoming: ParsedSubagentIdentityHint;
}): {
  model: string | undefined;
  modelIsRequestedHint: boolean | undefined;
} {
  const existingModel = input.existing?.model;
  const incomingModel = input.incoming.model;
  if (!incomingModel) {
    return {
      model: existingModel,
      modelIsRequestedHint: input.existing?.modelIsRequestedHint,
    };
  }
  if (
    input.incoming.modelIsRequestedHint === true &&
    existingModel !== undefined &&
    input.existing?.modelIsRequestedHint !== true
  ) {
    return {
      model: existingModel,
      modelIsRequestedHint: input.existing?.modelIsRequestedHint,
    };
  }
  return {
    model: incomingModel,
    modelIsRequestedHint: input.incoming.modelIsRequestedHint,
  };
}

export function mergeSubagentIdentityHints(
  existing: ParsedSubagentIdentityHint | undefined,
  incoming: ParsedSubagentIdentityHint,
): ParsedSubagentIdentityHint {
  const mergedModel = selectMergedModel({ existing, incoming });
  return {
    providerThreadId: incoming.providerThreadId ?? existing?.providerThreadId,
    agentId: incoming.agentId ?? existing?.agentId,
    nickname: incoming.nickname ?? existing?.nickname,
    role: incoming.role ?? existing?.role,
    model: mergedModel.model,
    prompt: incoming.prompt ?? existing?.prompt,
    status: incoming.status ?? existing?.status,
    message: incoming.message ?? existing?.message,
    modelIsRequestedHint: mergedModel.modelIsRequestedHint,
  };
}

export function buildSubagentIdentityDirectory(
  hints: ReadonlyArray<ParsedSubagentIdentityHint>,
): ParsedSubagentIdentityDirectory {
  const byProviderThreadId = new Map<string, ParsedSubagentIdentityHint>();
  const byAgentId = new Map<string, ParsedSubagentIdentityHint>();

  const upsert = (hint: ParsedSubagentIdentityHint) => {
    const providerThreadId = asTrimmedString(hint.providerThreadId);
    const agentId = asTrimmedString(hint.agentId);
    if (
      providerThreadId === undefined &&
      agentId === undefined &&
      hint.nickname === undefined &&
      hint.role === undefined
    ) {
      return;
    }

    const existingByThread = providerThreadId
      ? byProviderThreadId.get(providerThreadId)
      : undefined;
    const existingByAgent = agentId ? byAgentId.get(agentId) : undefined;
    const existing =
      existingByAgent !== undefined
        ? mergeSubagentIdentityHints(existingByThread, existingByAgent)
        : existingByThread;
    const merged = mergeSubagentIdentityHints(existing, {
      ...hint,
      ...(providerThreadId ? { providerThreadId } : {}),
      ...(agentId ? { agentId } : {}),
    });

    if (providerThreadId) {
      byProviderThreadId.set(providerThreadId, merged);
    }
    if (agentId) {
      byAgentId.set(agentId, merged);
    }
    if (merged.providerThreadId && merged.agentId) {
      byProviderThreadId.set(merged.providerThreadId, merged);
      byAgentId.set(merged.agentId, merged);
    }
  };

  for (const hint of hints) {
    upsert(hint);
  }

  return {
    byProviderThreadId,
    byAgentId,
  };
}

export function resolveSubagentIdentityFromDirectory(
  directory: ParsedSubagentIdentityDirectory,
  input: {
    providerThreadId?: string | null | undefined;
    agentId?: string | null | undefined;
  },
): ParsedSubagentIdentityHint | undefined {
  const normalizedProviderThreadId = asTrimmedString(input.providerThreadId);
  const normalizedAgentId = asTrimmedString(input.agentId);
  const threadEntry = normalizedProviderThreadId
    ? directory.byProviderThreadId.get(normalizedProviderThreadId)
    : undefined;
  const agentEntry = normalizedAgentId ? directory.byAgentId.get(normalizedAgentId) : undefined;
  if (!threadEntry && !agentEntry) {
    return undefined;
  }

  return mergeSubagentIdentityHints(agentEntry, {
    ...(threadEntry ?? {}),
    providerThreadId:
      threadEntry?.providerThreadId ?? agentEntry?.providerThreadId ?? normalizedProviderThreadId,
    agentId: threadEntry?.agentId ?? agentEntry?.agentId ?? normalizedAgentId,
  });
}

export function resolveSubagentIdentityHint(input: {
  hints: ReadonlyArray<ParsedSubagentIdentityHint>;
  providerThreadId?: string | null | undefined;
  agentId?: string | null | undefined;
}): ParsedSubagentIdentityHint | undefined {
  return resolveSubagentIdentityFromDirectory(buildSubagentIdentityDirectory(input.hints), input);
}
