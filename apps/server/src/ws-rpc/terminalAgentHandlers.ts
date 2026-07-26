import { WS_METHODS, WsRpcError } from "@agent-group/contracts";
import { Effect, Stream } from "effect";

import type { ServerRuntimeStartup } from "../serverRuntimeStartup";
import { TerminalAgentService } from "../terminalAgent/Services/TerminalAgentService";
import { bufferTerminalAgentStream } from "../terminalAgent/terminalAgentStreamBackpressure";
import { toWsRpcError } from "../wsRpcError";
import type { WsRpcHandlers } from "./types";

export function makeTerminalAgentHandlers(dependencies: {
  readonly runtimeStartup: typeof ServerRuntimeStartup.Service;
  readonly terminalAgentService: typeof TerminalAgentService.Service;
  readonly rpcEffect: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    fallbackMessage: string,
  ) => Effect.Effect<A, WsRpcError, R>;
}) {
  return {
    [WS_METHODS.terminalAgentGet]: (input) =>
      dependencies.rpcEffect(
        dependencies.runtimeStartup.enqueueCommand(
          dependencies.terminalAgentService.get(input.threadId),
        ),
        "Failed to get managed terminal",
      ),
    [WS_METHODS.terminalAgentStart]: (input) =>
      dependencies.rpcEffect(
        dependencies.runtimeStartup.enqueueCommand(dependencies.terminalAgentService.start(input)),
        "Failed to start managed terminal",
      ),
    [WS_METHODS.terminalAgentRestart]: (input) =>
      dependencies.rpcEffect(
        dependencies.runtimeStartup.enqueueCommand(
          dependencies.terminalAgentService.restart(input),
        ),
        "Failed to restart managed terminal",
      ),
    [WS_METHODS.terminalAgentSwitchToChat]: (input) =>
      dependencies.rpcEffect(
        dependencies.runtimeStartup.enqueueCommand(
          dependencies.terminalAgentService.switchToChat(input.threadId),
        ),
        "Failed to switch to chat",
      ),
    [WS_METHODS.terminalAgentWrite]: (input) =>
      dependencies.rpcEffect(
        dependencies.runtimeStartup.enqueueCommand(dependencies.terminalAgentService.write(input)),
        "Failed to write to managed terminal",
      ),
    [WS_METHODS.terminalAgentResize]: (input) =>
      dependencies.rpcEffect(
        dependencies.runtimeStartup.enqueueCommand(dependencies.terminalAgentService.resize(input)),
        "Failed to resize managed terminal",
      ),
    [WS_METHODS.terminalAgentSubscribe]: (input) =>
      bufferTerminalAgentStream(
        Stream.unwrap(
          dependencies.runtimeStartup.enqueueCommand(
            Effect.sync(() =>
              dependencies.terminalAgentService.subscribe(input.threadId, input.mode),
            ),
          ),
        ),
      ).pipe(
        Stream.mapError((cause) => toWsRpcError(cause, "Managed terminal event stream failed")),
      ),
  } satisfies Partial<WsRpcHandlers>;
}
