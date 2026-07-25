import { ORCHESTRATION_WS_METHODS, WsRpcError } from "@agent-group/contracts";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  makeServerRuntimeStartup,
  ServerRuntimeStartupError,
} from "../serverRuntimeStartup";
import { toWsRpcError } from "../wsRpcError";
import { makeOrchestrationHandlers } from "./orchestrationHandlers";

const rpcEffect = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  fallbackMessage: string,
) => effect.pipe(Effect.mapError((cause) => toWsRpcError(cause, fallbackMessage)));

describe("orchestration RPC startup admission", () => {
  it("queues state repair behind terminal recovery", async () => {
    const runtimeStartup = await Effect.runPromise(makeServerRuntimeStartup);
    let repairsExecuted = 0;
    const repairState = vi.fn(() =>
      Effect.sync(() => {
        repairsExecuted += 1;
        return {} as never;
      }),
    );
    const handlers = makeOrchestrationHandlers({
      checkpointDiffQuery: {} as never,
      config: {
        attachmentsDir: "/attachments",
        chatWorkspaceRoot: "/chat",
        studioWorkspaceRoot: "/studio",
      } as never,
      executionAdapterAuthority: {} as never,
      fileSystem: {} as never,
      highlightsQuery: {} as never,
      orchestrationEngine: { repairState } as never,
      path: {} as never,
      projectionReadModelQuery: {} as never,
      providerAdapterRegistry: {} as never,
      providerService: {} as never,
      runtimeStartup,
      workspaceSupport: {
        canonicalizeProjectWorkspaceRoot: () => Effect.succeed("/workspace"),
        prepareChatWorkspaceRoot: () => Effect.void,
        prepareStudioWorkspaceRoot: () => Effect.void,
      } as never,
      rpcEffect,
    });

    const pending = Effect.runPromise(
      handlers[ORCHESTRATION_WS_METHODS.repairState](),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repairsExecuted).toBe(0);

    await Effect.runPromise(runtimeStartup.markCommandReady);
    await pending;
    expect(repairState).toHaveBeenCalledOnce();
    expect(repairsExecuted).toBe(1);
  });

  it("maps startup failures through the existing RPC boundary", async () => {
    const runtimeStartup = await Effect.runPromise(makeServerRuntimeStartup);
    await Effect.runPromise(
      runtimeStartup.failCommandReady(new ServerRuntimeStartupError({
        message: "terminal recovery failed",
      })),
    );
    const handlers = makeOrchestrationHandlers({
      checkpointDiffQuery: {} as never,
      config: {
        attachmentsDir: "/attachments",
        chatWorkspaceRoot: "/chat",
        studioWorkspaceRoot: "/studio",
      } as never,
      executionAdapterAuthority: {} as never,
      fileSystem: {} as never,
      highlightsQuery: {} as never,
      orchestrationEngine: { repairState: () => Effect.succeed({} as never) } as never,
      path: {} as never,
      projectionReadModelQuery: {} as never,
      providerAdapterRegistry: {} as never,
      providerService: {} as never,
      runtimeStartup,
      workspaceSupport: {
        canonicalizeProjectWorkspaceRoot: () => Effect.succeed("/workspace"),
        prepareChatWorkspaceRoot: () => Effect.void,
        prepareStudioWorkspaceRoot: () => Effect.void,
      } as never,
      rpcEffect,
    });

    const failure = await Effect.runPromise(
      Effect.flip(handlers[ORCHESTRATION_WS_METHODS.repairState]()),
    );
    expect(failure).toBeInstanceOf(WsRpcError);
    expect(failure.message).toContain("terminal recovery failed");
  });
});
