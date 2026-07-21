import type { AutomationSchedule, ThreadId } from "@agent-group/contracts";

import { useTerminalStateStore, selectThreadTerminalState } from "../../terminalStateStore";
import type { ChatMessage } from "../../types";
import { newMessageId } from "~/lib/utils";

const SETUP_SCRIPT_TERMINAL_ACTIVITY_START_TIMEOUT_MS = 1_000;
const SETUP_SCRIPT_TERMINAL_MAX_RUNTIME_MS = 10 * 60 * 1000;

function terminalHasRunningSubprocess(threadId: ThreadId, terminalId: string): boolean {
  const terminalState = selectThreadTerminalState(
    useTerminalStateStore.getState().terminalStateByThreadId,
    threadId,
  );
  return terminalState.runningTerminalIds.includes(terminalId);
}

export function waitForSetupScriptTerminalActivity(input: {
  threadId: ThreadId;
  terminalId: string;
  observeStartTimeoutMs?: number;
  maxRuntimeMs?: number;
}): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  const observeStartTimeoutMs =
    input.observeStartTimeoutMs ?? SETUP_SCRIPT_TERMINAL_ACTIVITY_START_TIMEOUT_MS;
  const maxRuntimeMs = input.maxRuntimeMs ?? SETUP_SCRIPT_TERMINAL_MAX_RUNTIME_MS;

  return new Promise((resolve) => {
    let resolved = false;
    let observedRunning = terminalHasRunningSubprocess(input.threadId, input.terminalId);
    let observeStartTimer: number | null = null;
    let maxRuntimeTimer: number | null = null;

    const unsubscribe = useTerminalStateStore.subscribe(() => {
      checkRunningState();
    });

    const clearTimers = () => {
      if (observeStartTimer !== null) {
        window.clearTimeout(observeStartTimer);
        observeStartTimer = null;
      }
      if (maxRuntimeTimer !== null) {
        window.clearTimeout(maxRuntimeTimer);
        maxRuntimeTimer = null;
      }
    };

    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimers();
      unsubscribe();
      resolve();
    };

    const ensureMaxRuntimeTimer = () => {
      if (maxRuntimeTimer !== null) return;
      maxRuntimeTimer = window.setTimeout(finish, maxRuntimeMs);
    };

    function checkRunningState() {
      const running = terminalHasRunningSubprocess(input.threadId, input.terminalId);
      if (running) {
        observedRunning = true;
        if (observeStartTimer !== null) {
          window.clearTimeout(observeStartTimer);
          observeStartTimer = null;
        }
        ensureMaxRuntimeTimer();
        return;
      }
      if (observedRunning) {
        finish();
      }
    }

    checkRunningState();
    if (!observedRunning) {
      observeStartTimer = window.setTimeout(finish, observeStartTimeoutMs);
    }
  });
}

export function automationScheduleActivityPayload(schedule: AutomationSchedule) {
  switch (schedule.type) {
    case "manual":
      return { type: "manual" } as const;
    case "once":
      return { type: "once", runAt: schedule.runAt } as const;
    case "interval":
      return { type: "interval", everySeconds: schedule.everySeconds } as const;
    case "daily":
      return schedule.timezone
        ? { type: "daily", timeOfDay: schedule.timeOfDay, timezone: schedule.timezone }
        : { type: "daily", timeOfDay: schedule.timeOfDay };
    case "weekdays":
      return schedule.timezone
        ? { type: "weekdays", timeOfDay: schedule.timeOfDay, timezone: schedule.timezone }
        : { type: "weekdays", timeOfDay: schedule.timeOfDay };
    case "weekly":
      return schedule.timezone
        ? {
            type: "weekly",
            dayOfWeek: schedule.dayOfWeek,
            timeOfDay: schedule.timeOfDay,
            timezone: schedule.timezone,
          }
        : {
            type: "weekly",
            dayOfWeek: schedule.dayOfWeek,
            timeOfDay: schedule.timeOfDay,
          };
    case "cron":
      return {
        type: "cron",
        expression: schedule.expression,
        timezone: schedule.timezone,
      } as const;
  }
}

// Builds an ephemeral transcript bubble for the conversational automation-setup
// exchange. These never reach a provider and are not persisted.
export function makeAutomationSetupBubble(role: "user" | "assistant", text: string): ChatMessage {
  return {
    id: newMessageId(),
    role,
    text,
    createdAt: new Date().toISOString(),
    streaming: false,
    source: "native",
  };
}
