import { WsRpcGroup } from "@agent-group/contracts";
import { Effect, Layer, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { authErrorResponse, makeEffectAuthRequest } from "../auth/http";
import { ServerAuth } from "../auth/Services/ServerAuth";
import { SessionCredentialService } from "../auth/Services/SessionCredentialService";
import { ServerConfig } from "../config";
import { shouldRejectUntrustedRequestOrigin } from "../trustedOrigins";
import { makeWsRpcLayer } from "./layer";

const makeRpcWebSocketHttpEffect = RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
  spanPrefix: "ws.rpc",
  spanAttributes: {
    "rpc.transport": "websocket",
    "rpc.system": "effect-rpc",
  },
}).pipe(Effect.provide(makeWsRpcLayer().pipe(Layer.provideMerge(RpcSerialization.layerJson))));

export const websocketRpcRouteLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const rpcWebSocketHttpEffect = yield* makeRpcWebSocketHttpEffect;
    const router = yield* HttpRouter.HttpRouter;
    yield* router.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const config = yield* ServerConfig;
        const serverAuth = yield* ServerAuth;
        const sessions = yield* SessionCredentialService;
        const url = HttpServerRequest.toURL(request);
        if (
          !url ||
          shouldRejectUntrustedRequestOrigin({
            rawOrigin: request.headers.origin,
            requestOrigin: url.origin,
            config,
          })
        ) {
          return HttpServerResponse.text("Forbidden", { status: 403 });
        }
        const legacyToken = url.searchParams.get("token");
        const authenticatedSession =
          !config.authToken || legacyToken === config.authToken
            ? null
            : yield* serverAuth.authenticateWebSocketUpgrade(makeEffectAuthRequest(request));

        if (!authenticatedSession) return yield* rpcWebSocketHttpEffect;

        return yield* Effect.acquireUseRelease(
          sessions.markConnected(authenticatedSession.sessionId),
          () =>
            rpcWebSocketHttpEffect.pipe(
              Effect.raceFirst(
                sessions.streamChanges.pipe(
                  Stream.filter(
                    (change) =>
                      change.type === "clientRemoved" &&
                      change.sessionId === authenticatedSession.sessionId,
                  ),
                  Stream.take(1),
                  Stream.runDrain,
                  Effect.as(HttpServerResponse.empty({ status: 401 })),
                ),
              ),
            ),
          () => sessions.markDisconnected(authenticatedSession.sessionId),
        );
      }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
    );
  }),
);
