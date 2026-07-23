import { NodeWS } from "@effect/platform-node/NodeSocket";

const PATCHED = Symbol.for("agent-group.webSocketCompressionPatched");

const PER_MESSAGE_DEFLATE_OPTIONS = {
  clientNoContextTakeover: true,
  concurrencyLimit: 4,
  serverNoContextTakeover: true,
  threshold: 1_024,
  zlibDeflateOptions: { level: 3 },
} as const;

type CompressibleWebSocketServer = NodeWS.WebSocketServer & {
  readonly [PATCHED]?: true;
  readonly options: {
    perMessageDeflate: boolean | typeof PER_MESSAGE_DEFLATE_OPTIONS;
  };
};

export function patchWebSocketCompression(): void {
  // Effect's Node HTTP adapter owns a private `noServer` WebSocketServer and
  // does not expose its options. Configure it at the upgrade boundary instead.
  const serverPrototype = NodeWS.WebSocketServer.prototype as CompressibleWebSocketServer & {
    handleUpgrade: NodeWS.WebSocketServer["handleUpgrade"];
  };
  if (serverPrototype[PATCHED]) return;

  const originalHandleUpgrade = serverPrototype.handleUpgrade;
  serverPrototype.handleUpgrade = function compressedHandleUpgrade(
    this: NodeWS.WebSocketServer,
    request,
    socket,
    head,
    callback,
  ) {
    (this as CompressibleWebSocketServer).options.perMessageDeflate = PER_MESSAGE_DEFLATE_OPTIONS;
    return originalHandleUpgrade.call(this, request, socket, head, callback);
  } as NodeWS.WebSocketServer["handleUpgrade"];

  Object.defineProperty(serverPrototype, PATCHED, {
    configurable: false,
    enumerable: false,
    value: true,
  });
}
