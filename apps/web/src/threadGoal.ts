import {
  THREAD_GOAL_MAX_CHARS,
  type ThreadGoalStartBehavior,
  type ThreadId,
} from "@agent-group/contracts";

import { newCommandId } from "./lib/utils";
import { readNativeApi } from "./nativeApi";

function normalizedGoal(value: string): string {
  const goal = value.trim();
  if (goal.length > THREAD_GOAL_MAX_CHARS) {
    throw new Error(`Goals can be at most ${THREAD_GOAL_MAX_CHARS} characters.`);
  }
  return goal;
}

async function dispatchGoalMeta(
  threadId: ThreadId,
  patch:
    | { readonly goal: string; readonly goalStartBehavior?: ThreadGoalStartBehavior }
    | { readonly goalPaused: boolean }
    | { readonly goalAchieved: true },
): Promise<void> {
  const api = readNativeApi();
  if (!api) throw new Error("Agent Group API is unavailable.");
  await api.orchestration.dispatchCommand({
    type: "thread.meta.update",
    commandId: newCommandId(),
    threadId,
    ...patch,
  });
}

export function dispatchThreadGoal(
  threadId: ThreadId,
  goal: string,
  options: { readonly startBehavior?: ThreadGoalStartBehavior } = {},
): Promise<void> {
  return dispatchGoalMeta(threadId, {
    goal: normalizedGoal(goal),
    ...(options.startBehavior !== undefined ? { goalStartBehavior: options.startBehavior } : {}),
  });
}

export function dispatchThreadGoalPaused(threadId: ThreadId, paused: boolean): Promise<void> {
  return dispatchGoalMeta(threadId, { goalPaused: paused });
}

export function dispatchThreadGoalAchieved(threadId: ThreadId): Promise<void> {
  return dispatchGoalMeta(threadId, { goalAchieved: true });
}
