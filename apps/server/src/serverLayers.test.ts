import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId } from "@agent-group/contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { ServerConfig, type ServerConfigShape } from "./config";
import { ExecutionAdapterAuthority } from "./orchestration/Services/ExecutionAdapterAuthority";
import { ExecutionAdapterCoordinator } from "./orchestration/Services/ExecutionAdapterCoordinator";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite";
import { ProviderService, type ProviderServiceShape } from "./provider/Services/ProviderService";
import { ExecutionAdapterRuntimeLayerLive } from "./serverLayers";

function testConfig(baseDir: string): ServerConfigShape {
  const stateDir = path.join(baseDir, "state");
  const logsDir = path.join(stateDir, "logs");
  return {
    mode: "web",
    port: 0,
    host: "127.0.0.1",
    cwd: baseDir,
    homeDir: baseDir,
    chatWorkspaceRoot: path.join(baseDir, "chat"),
    studioWorkspaceRoot: path.join(baseDir, "studio"),
    baseDir,
    stateDir,
    secretsDir: path.join(stateDir, "secrets"),
    dbPath: path.join(stateDir, "state.sqlite"),
    settingsPath: path.join(stateDir, "settings.json"),
    keybindingsConfigPath: path.join(stateDir, "keybindings.json"),
    worktreesDir: path.join(baseDir, "worktrees"),
    attachmentsDir: path.join(stateDir, "attachments"),
    logsDir,
    serverLogPath: path.join(logsDir, "server.log"),
    serverRuntimeStatePath: path.join(stateDir, "server-runtime.json"),
    providerLogsDir: path.join(logsDir, "provider"),
    providerEventLogPath: path.join(logsDir, "provider", "events.log"),
    terminalLogsDir: path.join(logsDir, "terminals"),
    environmentIdPath: path.join(stateDir, "environment-id"),
    staticDir: undefined,
    devUrl: undefined,
    noBrowser: true,
    authToken: undefined,
    tailnetSidecarPath: undefined,
    tailnetProxyUrl: undefined,
    autoBootstrapProjectFromCwd: false,
    logProviderEvents: false,
    logWebSocketEvents: false,
  };
}

describe("server execution adapter layer", () => {
  it("shares one durable authority between the exported service and coordinator", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-group-adapter-layer-"));
    const provider = {
      listSessions: () => Effect.succeed([]),
    } as unknown as ProviderServiceShape;
    const layer = ExecutionAdapterRuntimeLayerLive.pipe(
      Layer.provideMerge(Layer.succeed(ProviderService, provider)),
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provideMerge(Layer.succeed(ServerConfig, testConfig(baseDir))),
      Layer.provideMerge(NodeServices.layer),
    );
    const threadId = ThreadId.makeUnsafe("thread-layer-identity");

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const authority = yield* ExecutionAdapterAuthority;
            const coordinator = yield* ExecutionAdapterCoordinator;
            const starting = yield* authority.beginTerminalSwitch({
              threadId,
              provider: "codex",
              runtimeInstanceId: "runtime-layer-identity",
              providerSessionId: null,
              startedAt: "2026-07-26T00:00:00.000Z",
            });

            expect(yield* coordinator.getState(threadId)).toEqual(starting);

            const updated = yield* coordinator.updateTerminalState({
              threadId,
              revision: starting.revision,
              patch: { status: "error", error: "identity-check" },
            });
            expect(yield* authority.getState(threadId)).toEqual(updated);
          }),
        ).pipe(Effect.provide(layer)),
      );
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
