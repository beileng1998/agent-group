import { TurnId } from "@agent-group/contracts";

import {
  finalizeAgentGroupTurn,
  markAgentGroupTurnStarted,
} from "../agentGroup/runtime";
import { prepareTerminalAgentPrompt } from "./terminalAgentPromptPreparation";
import type {
  TerminalAgentEvent,
  TerminalAgentHookResponse,
} from "./terminalAgentProtocol";
import {
  assertCurrentTerminalRuntime,
  assertTerminalHookNotAborted,
  observeTerminalMessage,
  publishTerminalRuntimeEvent,
  type RuntimeEventDependencies,
  terminalEventKey,
  terminalProviderEventBase,
  updateTerminalRuntimeState,
} from "./terminalAgentRuntimeEventSupport";
import {
  retireTerminalTurnContext,
} from "./terminalAgentTurnCleanup";
import type { ActiveTerminalTurn } from "./terminalAgentRuntimeTypes";

const MAX_ACCEPTED_PROMPT_EVENTS = 500;

async function requireManagedTerminalPromptEnabled(
  dependencies: RuntimeEventDependencies,
) {
  const settings = await dependencies.getSettings();
  if (!settings.enableManagedAgentTerminal) {
    throw new Error("Managed Agent Terminal is disabled in server settings.");
  }
  return settings;
}

function rememberAcceptedPrompt(turn: ActiveTerminalTurn, id: string, prompt: string): void {
  if (turn.acceptedPromptEvents.size >= MAX_ACCEPTED_PROMPT_EVENTS) {
    const oldest = turn.acceptedPromptEvents.keys().next().value;
    if (oldest !== undefined) turn.acceptedPromptEvents.delete(oldest);
  }
  turn.acceptedPromptEvents.set(id, prompt);
}

async function acceptSteer(
  dependencies: RuntimeEventDependencies,
  id: string,
  prompt: string,
  signal: AbortSignal,
): Promise<TerminalAgentHookResponse> {
  const turn = dependencies.runtime.activeTurn!;
  const pending = turn.pendingPrompt;
  if (
    !pending ||
    pending.promptEventId !== id ||
    pending.prompt !== prompt
  ) {
    throw new Error("The accepted prompt does not match the prepared Agent Turn.");
  }
  assertTerminalHookNotAborted(signal);
  await assertCurrentTerminalRuntime(
    dependencies.runtime,
    dependencies.coordinator,
  );
  assertTerminalHookNotAborted(signal);
  await observeTerminalMessage(dependencies, id, turn, "user", prompt);
  assertTerminalHookNotAborted(signal);

  const previousContext = turn.context;
  await updateTerminalRuntimeState(dependencies, {});
  assertTerminalHookNotAborted(signal);
  dependencies.runtime.context = pending.context;
  turn.context = pending.context;
  turn.deliveredContext = pending.deliveredContext;
  turn.pendingPrompt = null;
  rememberAcceptedPrompt(turn, id, prompt);
  await retireTerminalTurnContext(dependencies.runtime, {
    turnId: turn.turnId,
    context: previousContext,
  });
  return {};
}

export async function acceptTerminalPrompt(
  dependencies: RuntimeEventDependencies,
  id: string,
  prompt: unknown,
  signal: AbortSignal,
): Promise<TerminalAgentHookResponse> {
  const turn = dependencies.runtime.activeTurn;
  if (!turn || typeof prompt !== "string") {
    throw new Error("The accepted prompt does not match the prepared Agent Turn.");
  }
  const acceptedPrompt = turn.acceptedPromptEvents.get(id);
  if (acceptedPrompt !== undefined) {
    if (acceptedPrompt !== prompt) {
      throw new Error("The accepted prompt does not match the prepared Agent Turn.");
    }
    return {};
  }
  await requireManagedTerminalPromptEnabled(dependencies);
  if (turn.accepted) {
    return acceptSteer(dependencies, id, prompt, signal);
  }
  if (turn.promptEventId !== id || turn.prompt !== prompt) {
    throw new Error("The accepted prompt does not match the prepared Agent Turn.");
  }

  assertTerminalHookNotAborted(signal);
  await assertCurrentTerminalRuntime(
    dependencies.runtime,
    dependencies.coordinator,
  );
  let admissionTouched = false;
  let contextMarked = false;
  try {
    if (turn.tracksAgentGroupContext) {
      await markAgentGroupTurnStarted(
        dependencies.runtime.coordinates,
        turn.turnId,
        turn.awarenessHead,
      );
      contextMarked = true;
      admissionTouched = true;
    }
    assertTerminalHookNotAborted(signal);
    admissionTouched = true;
    await observeTerminalMessage(
      dependencies,
      turn.promptEventId,
      turn,
      "user",
      turn.prompt,
    );
    assertTerminalHookNotAborted(signal);
    await publishTerminalRuntimeEvent(dependencies, {
      ...terminalProviderEventBase(
        dependencies.runtime,
        turn.promptEventId,
        turn,
      ),
      type: "turn.started",
      payload: {
        ...(dependencies.runtime.model
          ? { model: dependencies.runtime.model }
          : {}),
        ...(dependencies.runtime.effort
          ? { effort: dependencies.runtime.effort }
          : {}),
      },
    });
    admissionTouched = true;
    assertTerminalHookNotAborted(signal);
    await updateTerminalRuntimeState(dependencies, {
      status: "running",
      activeTurnId: turn.turnId,
      error: null,
    });
    turn.accepted = true;
    rememberAcceptedPrompt(turn, turn.promptEventId, turn.prompt);
    return {};
  } catch (cause) {
    if (signal.aborted) throw cause;
    if (contextMarked) {
      await finalizeAgentGroupTurn({
        ...dependencies.runtime.coordinates,
        turnId: turn.turnId,
        successful: false,
      }).catch(() => null);
    }
    if (admissionTouched) {
      await updateTerminalRuntimeState(dependencies, {
        status: "attention",
        activeTurnId: null,
        error: "Agent Turn admission failed. Retry.",
      }).catch(() => undefined);
    }
    throw cause;
  }
}

export async function handleTerminalPrompt(
  dependencies: RuntimeEventDependencies,
  event: Extract<TerminalAgentEvent, { type: "prompt_submit" }>,
  id: string,
  signal: AbortSignal,
): Promise<TerminalAgentHookResponse> {
  const settings = await requireManagedTerminalPromptEnabled(dependencies);
  const existing = dependencies.runtime.activeTurn;
  if (existing) {
    if (existing.promptEventId === id && existing.prompt === event.prompt) {
      return {
        turnId: existing.turnId,
        additionalContext: existing.deliveredContext,
      };
    }
    if (
      existing.pendingPrompt?.promptEventId === id &&
      existing.pendingPrompt.prompt === event.prompt
    ) {
      return {
        turnId: existing.turnId,
        additionalContext: existing.pendingPrompt.deliveredContext,
      };
    }
    if (!existing.accepted) {
      return { block: { message: "The current Agent Turn is still starting." } };
    }
    if (existing.pendingPrompt) {
      return { block: { message: "The previous input is still being accepted." } };
    }
    assertTerminalHookNotAborted(signal);
    await assertCurrentTerminalRuntime(
      dependencies.runtime,
      dependencies.coordinator,
    );
    const prepared = await prepareTerminalAgentPrompt({
      runtime: dependencies.runtime,
      settings,
      prompt: event.prompt,
      turnId: existing.turnId,
    });
    if (signal.aborted) {
      await retireTerminalTurnContext(dependencies.runtime, {
        turnId: existing.turnId,
        context: prepared.context,
      });
      assertTerminalHookNotAborted(signal);
    }
    existing.pendingPrompt = {
      promptEventId: id,
      prompt: event.prompt,
      deliveredContext: prepared.delivered,
      context: prepared.context,
    };
    return {
      turnId: existing.turnId,
      additionalContext: prepared.delivered,
    };
  }

  assertTerminalHookNotAborted(signal);
  await assertCurrentTerminalRuntime(
    dependencies.runtime,
    dependencies.coordinator,
  );
  const turnId = TurnId.makeUnsafe(
    event.providerTurnId
      ? `terminal:${dependencies.runtime.runtimeInstanceId}:${event.providerTurnId}`
      : terminalEventKey(dependencies.runtime, id, "turn"),
  );
  const prepared = await prepareTerminalAgentPrompt({
    runtime: dependencies.runtime,
    settings,
    prompt: event.prompt,
    turnId,
  });
  if (signal.aborted) {
    await retireTerminalTurnContext(dependencies.runtime, {
      turnId,
      context: prepared.context,
    });
    assertTerminalHookNotAborted(signal);
  }
  dependencies.runtime.context = prepared.context;
  dependencies.runtime.activeTurn = {
    turnId,
    promptEventId: id,
    prompt: event.prompt,
    providerTurnId: event.providerTurnId ?? null,
    awarenessHead: prepared.awarenessHead,
    deliveredContext: prepared.delivered,
    context: prepared.context,
    tracksAgentGroupContext: prepared.tracksAgentGroupContext,
    pendingPrompt: null,
    acceptedPromptEvents: new Map(),
    accepted: false,
  };
  return { turnId, additionalContext: prepared.delivered };
}
