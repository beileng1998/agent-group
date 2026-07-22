import http from "node:http";

import { NodeWS } from "@effect/platform-node/NodeSocket";
import { expect, it } from "vitest";

import { patchWebSocketCompression } from "./webSocketCompression";

it("negotiates per-message compression for websocket clients", async () => {
  patchWebSocketCompression();
  patchWebSocketCompression();

  const server = http.createServer();
  const webSocketServer = new NodeWS.WebSocketServer({ server });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server address");

  const client = new NodeWS.WebSocket(`ws://127.0.0.1:${address.port}`);
  try {
    await new Promise<void>((resolve, reject) => {
      client.addEventListener("open", () => resolve(), { once: true });
      client.addEventListener("error", () => reject(new Error("WebSocket open failed")), {
        once: true,
      });
    });
    expect(client.extensions).toContain("permessage-deflate");
  } finally {
    client.close();
    await new Promise<void>((resolve) => webSocketServer.close(() => resolve()));
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
