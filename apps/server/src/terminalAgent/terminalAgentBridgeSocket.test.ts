import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  TerminalAgentBridgeServer,
  terminalAgentBridgeEndpoint,
} from "./terminalAgentBridgeServer";

const bridges: TerminalAgentBridgeServer[] = [];
const directories: string[] = [];
const endpoints: string[] = [];

afterEach(async () => {
  await Promise.allSettled(bridges.splice(0).map((bridge) => bridge.close()));
  await Promise.all(
    directories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
  await Promise.all(
    endpoints.splice(0).map((endpoint) => fs.rm(endpoint, { force: true })),
  );
});

describe("TerminalAgentBridgeServer Unix socket ownership", () => {
  it.runIf(process.platform !== "win32")(
    "creates a private socket and removes it on close",
    async () => {
      const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-bridge-"));
      directories.push(stateDir);
      const bridge = new TerminalAgentBridgeServer(stateDir);
      bridges.push(bridge);
      await bridge.start();

      const socketStat = await fs.lstat(bridge.endpoint);
      expect(socketStat.isSocket()).toBe(true);
      expect(socketStat.mode & 0o777).toBe(0o600);

      await bridge.close();
      await expect(fs.lstat(bridge.endpoint)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it.runIf(process.platform !== "win32")(
    "refuses to replace a non-socket endpoint",
    async () => {
      const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-group-bridge-file-"));
      directories.push(stateDir);
      const bridge = new TerminalAgentBridgeServer(stateDir);
      bridges.push(bridge);
      endpoints.push(bridge.endpoint);
      await fs.writeFile(bridge.endpoint, "do not replace");

      await expect(bridge.start()).rejects.toThrow("is not a socket");
      await expect(fs.readFile(bridge.endpoint, "utf8")).resolves.toBe("do not replace");
      await bridge.close();
      await expect(fs.readFile(bridge.endpoint, "utf8")).resolves.toBe("do not replace");
    },
  );

  it("derives stable, bounded platform endpoints without exposing state paths", () => {
    const stateDir = "/private/project/state";
    const unixEndpoint = terminalAgentBridgeEndpoint(stateDir, "darwin");
    const windowsEndpoint = terminalAgentBridgeEndpoint(stateDir, "win32");

    expect(Buffer.byteLength(unixEndpoint)).toBeLessThan(90);
    expect(unixEndpoint).not.toContain(stateDir);
    expect(windowsEndpoint).toMatch(/^\\\\\.\\pipe\\agent-group-hooks-[a-f0-9]{20}$/u);
  });
});
