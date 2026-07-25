import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TerminalAgentBridgeServer } from "./terminalAgentBridgeServer";

const bridges: TerminalAgentBridgeServer[] = [];
const tempDirs: string[] = [];

async function makeStateDir(): Promise<string> {
  const stateDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "agent-group-bridge-socket-"),
  );
  tempDirs.push(stateDir);
  return stateDir;
}

function makeBridge(stateDir: string): TerminalAgentBridgeServer {
  const bridge = new TerminalAgentBridgeServer(stateDir);
  bridges.push(bridge);
  return bridge;
}

function requestStatus(endpoint: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { socketPath: endpoint, path: "/missing", method: "GET" },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      },
    );
    request.once("error", reject);
    request.end();
  });
}

afterEach(async () => {
  for (const bridge of bridges.splice(0).reverse()) {
    await bridge.close();
  }
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe.skipIf(
  process.platform === "win32",
)("TerminalAgentBridgeServer Unix socket ownership", () => {
  it("refuses to unlink a reachable bridge endpoint", async () => {
    const stateDir = await makeStateDir();
    const first = makeBridge(stateDir);
    const second = makeBridge(stateDir);
    await first.start();
    const before = await fs.lstat(first.endpoint);

    await expect(second.start()).rejects.toThrow(
      "Managed terminal bridge endpoint is already active.",
    );

    const after = await fs.lstat(first.endpoint);
    expect({ dev: after.dev, ino: after.ino }).toEqual({
      dev: before.dev,
      ino: before.ino,
    });
    await expect(requestStatus(first.endpoint)).resolves.toBe(404);
  });

  it("does not unlink a replacement socket when the old owner closes", async () => {
    const stateDir = await makeStateDir();
    const oldOwner = makeBridge(stateDir);
    await oldOwner.start();
    const oldIdentity = await fs.lstat(oldOwner.endpoint);

    await fs.rm(oldOwner.endpoint);
    const replacement = makeBridge(stateDir);
    await replacement.start();
    const replacementIdentity = await fs.lstat(replacement.endpoint);
    expect(replacementIdentity.ino).not.toBe(oldIdentity.ino);

    await oldOwner.close();

    const afterClose = await fs.lstat(replacement.endpoint);
    expect({ dev: afterClose.dev, ino: afterClose.ino }).toEqual({
      dev: replacementIdentity.dev,
      ino: replacementIdentity.ino,
    });
    await expect(requestStatus(replacement.endpoint)).resolves.toBe(404);
  });

  it("removes the endpoint when the owning bridge closes", async () => {
    const stateDir = await makeStateDir();
    const bridge = makeBridge(stateDir);
    await bridge.start();

    await bridge.close();

    await expect(fs.lstat(bridge.endpoint)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
