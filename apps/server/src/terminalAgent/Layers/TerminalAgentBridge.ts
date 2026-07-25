import { Effect, Layer } from "effect";

import { ServerConfig } from "../../config";
import {
  TerminalAgentBridge,
  type TerminalAgentBridgeShape,
} from "../Services/TerminalAgentBridge";
import { TerminalAgentBridgeServer } from "../terminalAgentBridgeServer";

export const TerminalAgentBridgeLive = Layer.effect(
  TerminalAgentBridge,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    let startPromise: Promise<void> | null = null;
    const server = yield* Effect.acquireRelease(
      Effect.sync(() => new TerminalAgentBridgeServer(config.stateDir)),
      (bridge) =>
        Effect.promise(async () => {
          await startPromise?.catch(() => {});
          await bridge.close();
        }).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("managed terminal bridge failed to close", { cause }),
          ),
        ),
    );
    const ensureStarted = () => {
      if (startPromise === null) {
        startPromise = server.start().catch((cause) => {
          startPromise = null;
          throw cause;
        });
      }
      return startPromise;
    };
    return {
      endpoint: server.endpoint,
      register: (runtimeInstanceId, handler) =>
        Effect.tryPromise({
          try: async () => {
            await ensureStarted();
            return server.register(runtimeInstanceId, handler);
          },
          catch: (cause) =>
            cause instanceof Error
              ? cause
              : new Error("Terminal bridge registration failed.", { cause }),
        }),
    } satisfies TerminalAgentBridgeShape;
  }),
);
