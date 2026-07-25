import { randomUUID } from "node:crypto";

import { Effect, Fiber } from "effect";

import { finalizeAgentGroupTurn } from "../agentGroup/runtime";
import { parseTerminalAgentBridgeEvent } from "./terminalAgentBridgeEvents";
import type {
  TerminalAgentBridgeHandler,
  TerminalAgentBridgePromise,
} from "./terminalAgentBridgeOperation";
import type {
  TerminalAgentEvent,
  TerminalAgentHookResponse,
} from "./terminalAgentProtocol";
import { observeTerminalAgentModel } from "./terminalAgentModelObservation";
import {
  acceptTerminalPrompt,
  handleTerminalPrompt,
} from "./terminalAgentPromptEvents";
import {
  assertTerminalHookNotAborted,
  observeTerminalMessage,
  publishTerminalRuntimeEvent,
  type RuntimeEventDependencies,
  terminalEventKey,
  terminalProviderEventBase,
  updateTerminalRuntimeState,
} from "./terminalAgentRuntimeEventSupport";
import {
  retireTerminalTurnContexts,
} from "./terminalAgentTurnCleanup";
import type { TerminalAgentRuntimeRecord } from "./terminalAgentRuntimeTypes";

export type { RuntimeEventDependencies };

function rememberResponse(
  runtime: TerminalAgentRuntimeRecord,
  id: string,
  response: TerminalAgentHookResponse,
): TerminalAgentHookResponse {
  if (runtime.eventResponses.size >= 500) {
    const oldest = runtime.eventResponses.keys().next().value;
    if (oldest !== undefined) runtime.eventResponses.delete(oldest);
  }
  runtime.eventResponses.set(id, response);
  return response;
}

async function settleTurn(
  dependencies: RuntimeEventDependencies,
  id: string,
  successful: boolean,
  assistantText: string | undefined,
  reason: string,
  updateAuthority = true,
  signal?: AbortSignal,
): Promise<void> {
  if (signal) assertTerminalHookNotAborted(signal);
  const turn = dependencies.runtime.activeTurn;
  if (!turn) return;
  if (!turn.accepted) {
    await retireTerminalTurnContexts(dependencies.runtime, turn);
    if (signal) assertTerminalHookNotAborted(signal);
    dependencies.runtime.activeTurn = null;
    return;
  }
  if (successful && assistantText?.trim()) {
    await observeTerminalMessage(dependencies, id, turn, "assistant", assistantText);
    if (signal) assertTerminalHookNotAborted(signal);
  }
  await publishTerminalRuntimeEvent(
    dependencies,
    successful
      ? {
          ...terminalProviderEventBase(dependencies.runtime, id, turn),
          type: "turn.completed",
          payload: { state: "completed" },
        }
      : {
          ...terminalProviderEventBase(dependencies.runtime, id, turn),
          type: "turn.aborted",
          payload: { reason },
      },
  );
  if (signal) assertTerminalHookNotAborted(signal);
  if (turn.tracksAgentGroupContext) {
    await finalizeAgentGroupTurn({
      ...dependencies.runtime.coordinates,
      turnId: turn.turnId,
      successful,
    });
    if (signal) assertTerminalHookNotAborted(signal);
  }
  if (updateAuthority) {
    await updateTerminalRuntimeState(dependencies, {
      status: successful ? "ready" : "attention",
      activeTurnId: null,
      error: successful ? null : reason,
    });
    if (signal) assertTerminalHookNotAborted(signal);
  }
  await retireTerminalTurnContexts(dependencies.runtime, turn);
  if (signal) assertTerminalHookNotAborted(signal);
  dependencies.runtime.activeTurn = null;
  if (successful) dependencies.runtime.transcriptBootstrap = null;
}

async function handleEvent(
  dependencies: RuntimeEventDependencies,
  event: TerminalAgentEvent,
  id: string,
  signal: AbortSignal,
): Promise<TerminalAgentHookResponse> {
  if (
    event.type === "session_start" ||
    event.type === "prompt_submit" ||
    event.type === "runtime_state"
  ) {
    assertTerminalHookNotAborted(signal);
    await observeTerminalAgentModel({
      runtime: dependencies.runtime,
      coordinator: dependencies.coordinator,
      engine: dependencies.engine,
      event,
      commandKey: terminalEventKey(dependencies.runtime, id, "model:command"),
    });
    assertTerminalHookNotAborted(signal);
  }
  switch (event.type) {
    case "session_start":
      assertTerminalHookNotAborted(signal);
      await dependencies.adoptProviderResumeCursor(
        event.providerResumeCursor,
        event.providerSessionId,
      );
      assertTerminalHookNotAborted(signal);
      await updateTerminalRuntimeState(dependencies, {
        status: "ready",
        providerSessionId: event.providerSessionId,
        error: null,
      });
      assertTerminalHookNotAborted(signal);
      await publishTerminalRuntimeEvent(dependencies, {
        ...terminalProviderEventBase(dependencies.runtime, id),
        type: "session.started",
        payload: { message: `Managed ${dependencies.runtime.provider} terminal ready.` },
      });
      assertTerminalHookNotAborted(signal);
      dependencies.runtime.providerSessionId = event.providerSessionId;
      dependencies.runtime.handshakeReceived = true;
      dependencies.runtime.capabilities = {
        ...dependencies.runtime.capabilities,
        hookSchema: "handshake-verified",
      };
      return {};
    case "prompt_submit":
      return handleTerminalPrompt(dependencies, event, id, signal);
    case "subagent_start":
      return dependencies.runtime.activeTurn
        ? { additionalContext: dependencies.runtime.activeTurn.deliveredContext }
        : { block: { message: "No managed Agent Turn is active." } };
    case "turn_stop":
      if (event.hasBackgroundWork) {
        return {};
      }
      await settleTurn(
        dependencies,
        id,
        true,
        event.assistantText,
        "Agent Turn completed.",
        true,
        signal,
      );
      return {};
    case "turn_failure":
      await settleTurn(
        dependencies,
        id,
        false,
        undefined,
        event.message,
        true,
        signal,
      );
      return {};
    case "runtime_state":
      return {
        statusLine: `Agent Group · ${dependencies.runtime.activeTurn ? "Running" : "Ready"}`,
      };
    case "session_compact":
      if (!event.willRetry) {
        await settleTurn(
          dependencies,
          id,
          false,
          undefined,
          event.reason,
          true,
          signal,
        );
      }
      return dependencies.runtime.activeTurn
        ? { additionalContext: dependencies.runtime.activeTurn.deliveredContext }
        : {};
    case "session_end":
      await settleTurn(
        dependencies,
        id,
        false,
        undefined,
        event.reason ?? "Agent Session ended.",
        true,
        signal,
      );
      await updateTerminalRuntimeState(dependencies, {
        status: "attention",
        activeTurnId: null,
        error: event.reason ?? "Agent Session ended.",
      });
      assertTerminalHookNotAborted(signal);
      dependencies.runtime.handshakeReceived = false;
      return {};
    case "unmanaged_input":
      await settleTurn(
        dependencies,
        id,
        false,
        undefined,
        event.message,
        true,
        signal,
      );
      await updateTerminalRuntimeState(dependencies, {
        status: "context-blocked",
        activeTurnId: null,
        error: event.message,
      });
      assertTerminalHookNotAborted(signal);
      return { block: { message: event.message } };
  }
}

export function makeTerminalAgentBridgeHandler(
  dependencies: RuntimeEventDependencies,
): TerminalAgentBridgeHandler {
  return (request, signal) => {
    const id = request.eventId ?? randomUUID();
    const run = async (effectSignal: AbortSignal) => {
      const activeSignal = AbortSignal.any([signal, effectSignal]);
      assertTerminalHookNotAborted(activeSignal);
      if (request.mode === "prompt-accepted") {
        const input =
          request.input && typeof request.input === "object"
            ? (request.input as Record<string, unknown>)
            : {};
        return await acceptTerminalPrompt(
          dependencies,
          id,
          input.prompt,
          activeSignal,
        );
      }
      const event = parseTerminalAgentBridgeEvent(dependencies.runtime, request);
      const eventId = event.eventId ?? id;
      const cached = dependencies.runtime.eventResponses.get(eventId);
      if (cached) return cached;
      let response: TerminalAgentHookResponse;
      try {
        response = await handleEvent(
          dependencies,
          event,
          eventId,
          activeSignal,
        );
      } catch (cause) {
        if (event.type === "session_start" && !activeSignal.aborted) {
          await updateTerminalRuntimeState(dependencies, {
            status: "context-blocked",
            activeTurnId: null,
            error: "Agent Terminal session handshake failed. Retry or restart the terminal.",
          }).catch(() => {
            // A newer authority epoch already superseded this failed handshake.
          });
        }
        throw cause;
      }
      assertTerminalHookNotAborted(activeSignal);
      return rememberResponse(dependencies.runtime, eventId, response);
    };
    const operation = Effect.acquireUseRelease(
      dependencies.coordinator.acquireTerminalOperation({
        threadId: dependencies.runtime.threadId,
        revision: dependencies.runtime.revision,
        generation: dependencies.runtime.generation,
        claimId: `hook:${dependencies.runtime.runtimeInstanceId}:${id}:${request.mode ?? "event"}`,
      }),
      () =>
        Effect.tryPromise({
          try: run,
          catch: (cause) => cause,
        }),
      (claim) => claim.release,
    );
    const fiber = Effect.runFork(operation);
    const result = Effect.runPromise(Fiber.join(fiber)) as TerminalAgentBridgePromise;
    result.cancel = async () => {
      await Effect.runPromise(Fiber.interrupt(fiber));
    };
    return result;
  };
}

export async function abortTerminalAgentTurn(
  dependencies: RuntimeEventDependencies,
  reason: string,
  options: { readonly updateAuthority?: boolean } = {},
): Promise<void> {
  await settleTurn(
    dependencies,
    `abort:${randomUUID()}`,
    false,
    undefined,
    reason,
    options.updateAuthority ?? true,
  );
}
