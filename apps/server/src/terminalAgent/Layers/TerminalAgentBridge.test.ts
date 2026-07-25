import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { ServerConfig, type ServerConfigShape } from "../../config";
import { TerminalAgentBridge } from "../Services/TerminalAgentBridge";
import { TerminalAgentBridgeLive } from "./TerminalAgentBridge";

describe("TerminalAgentBridgeLive", () => {
  it("does not listen until the first runtime registers", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-group-lazy-bridge-"));
    const stateDir = path.join(baseDir, "state");
    let endpoint = "";

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const bridge = yield* TerminalAgentBridge;
            endpoint = bridge.endpoint;
            if (process.platform !== "win32") {
              expect(fs.existsSync(endpoint)).toBe(false);
            }

            const registration = yield* bridge.register(
              "runtime-lazy-start",
              async () => ({ ok: true }),
            );
            if (process.platform !== "win32") {
              expect(fs.existsSync(endpoint)).toBe(true);
            }
            registration.unregister();
          }),
        ).pipe(
          Effect.provide(TerminalAgentBridgeLive),
          Effect.provide(
            Layer.succeed(ServerConfig, {
              stateDir,
            } as ServerConfigShape),
          ),
        ),
      );

      if (process.platform !== "win32") {
        expect(fs.existsSync(endpoint)).toBe(false);
      }
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
