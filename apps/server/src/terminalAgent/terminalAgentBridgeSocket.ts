import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import type http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const SOCKET_PROBE_TIMEOUT_MS = 1_000;

export interface TerminalAgentBridgeSocketIdentity {
  readonly device: number;
  readonly inode: number;
}

interface ProtectedSocket {
  readonly path: string;
}

export function terminalAgentBridgeEndpoint(
  stateDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const suffix = createHash("sha256").update(stateDir).digest("hex").slice(0, 20);
  if (platform === "win32") return `\\\\.\\pipe\\agent-group-hooks-${suffix}`;
  const candidate = path.join(os.tmpdir(), `agent-group-hooks-${suffix}.sock`);
  return Buffer.byteLength(candidate) < 90
    ? candidate
    : path.join("/tmp", `agent-group-hooks-${suffix}.sock`);
}

function socketIdentity(
  stat: Awaited<ReturnType<typeof fs.lstat>>,
): TerminalAgentBridgeSocketIdentity {
  return { device: stat.dev, inode: stat.ino };
}

function sameSocketIdentity(
  left: TerminalAgentBridgeSocketIdentity,
  right: TerminalAgentBridgeSocketIdentity,
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

async function socketIsReachable(endpoint: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let settled = false;
    const finish = (result: boolean, cause?: Error) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      if (cause) reject(cause);
      else resolve(result);
    };
    socket.setTimeout(SOCKET_PROBE_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () =>
      finish(false, new Error("Managed terminal bridge socket probe timed out.")),
    );
    socket.once("error", (cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT" || cause.code === "ECONNREFUSED") {
        finish(false);
        return;
      }
      finish(false, cause);
    });
  });
}

export async function prepareTerminalAgentBridgeEndpoint(endpoint: string): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(endpoint);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
    throw cause;
  }
  if (!stat.isSocket()) {
    throw new Error("Managed terminal bridge endpoint is not a socket.");
  }
  if (
    typeof stat.uid === "number" &&
    typeof process.getuid === "function" &&
    stat.uid !== process.getuid()
  ) {
    throw new Error("Managed terminal bridge socket has a different owner.");
  }
  if (await socketIsReachable(endpoint)) {
    throw new Error("Managed terminal bridge endpoint is already active.");
  }
  const expectedIdentity = socketIdentity(stat);
  let current;
  try {
    current = await fs.lstat(endpoint);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
    throw cause;
  }
  if (!current.isSocket() || !sameSocketIdentity(expectedIdentity, socketIdentity(current))) {
    throw new Error("Managed terminal bridge endpoint changed during startup.");
  }
  await fs.rm(endpoint);
}

export async function removeOwnedTerminalAgentBridgeSocket(
  endpoint: string,
  identity: TerminalAgentBridgeSocketIdentity,
): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(endpoint);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
    throw cause;
  }
  if (stat.isSocket() && sameSocketIdentity(identity, socketIdentity(stat))) {
    await fs.rm(endpoint);
  }
}

async function protectReplacementSocket(
  endpoint: string,
  identity: TerminalAgentBridgeSocketIdentity | null,
): Promise<ProtectedSocket | null> {
  if (!identity) return null;
  let stat;
  try {
    stat = await fs.lstat(endpoint);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
  if (sameSocketIdentity(identity, socketIdentity(stat))) return null;
  const protectedPath = path.join(
    path.dirname(endpoint),
    `.agent-group-hook-${randomBytes(8).toString("hex")}.hold`,
  );
  await fs.rename(endpoint, protectedPath);
  return { path: protectedPath };
}

export async function closeBridgeHttpServer(
  server: http.Server,
  endpoint?: string,
  identity: TerminalAgentBridgeSocketIdentity | null = null,
): Promise<void> {
  if (!server.listening) return;
  const protectedSocket = endpoint ? await protectReplacementSocket(endpoint, identity) : null;
  try {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  } finally {
    if (endpoint && protectedSocket) {
      await fs.rename(protectedSocket.path, endpoint);
    }
  }
}
