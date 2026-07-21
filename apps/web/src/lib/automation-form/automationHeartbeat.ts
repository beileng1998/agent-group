import type { AutomationDefinition, ThreadId } from "@agent-group/contracts";

const byAutomationName = (left: AutomationDefinition, right: AutomationDefinition): number =>
  left.name.localeCompare(right.name);

/** Heartbeat automations targeting a single thread, sorted by name. */
export function heartbeatAutomationsForThread(
  definitions: readonly AutomationDefinition[],
  threadId: ThreadId,
): AutomationDefinition[] {
  return definitions
    .filter(
      (definition) => definition.mode === "heartbeat" && definition.targetThreadId === threadId,
    )
    .toSorted(byAutomationName);
}

/** All heartbeat automations grouped by their target thread and sorted by name. */
export function groupHeartbeatAutomationsByTargetThread(
  definitions: readonly AutomationDefinition[],
): Map<ThreadId, AutomationDefinition[]> {
  const byThreadId = new Map<ThreadId, AutomationDefinition[]>();
  for (const definition of definitions) {
    if (definition.mode !== "heartbeat" || !definition.targetThreadId) continue;
    const existing = byThreadId.get(definition.targetThreadId);
    if (existing) {
      existing.push(definition);
    } else {
      byThreadId.set(definition.targetThreadId, [definition]);
    }
  }
  for (const [threadId, automations] of byThreadId) {
    byThreadId.set(threadId, automations.toSorted(byAutomationName));
  }
  return byThreadId;
}
