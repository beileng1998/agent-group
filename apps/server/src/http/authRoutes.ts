import {
  AuthBootstrapInput,
  AuthCreatePairingCredentialInput,
  AuthRevokeClientSessionInput,
  AuthRevokePairingLinkInput,
  AuthSessionId,
} from "@agent-group/contracts";
import { DateTime, Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { authErrorResponse, makeEffectAuthRequest } from "../auth/http";
import { encodeSessionCookie, maybeRenewSessionCookie } from "../auth/sessionCookie";
import { ServerAuth } from "../auth/Services/ServerAuth";
import { SessionCredentialService } from "../auth/Services/SessionCredentialService";
import { deriveAuthClientMetadata } from "../auth/utils";
import { ServerConfig, type ServerConfigShape } from "../config";

const decodeBootstrapInput = Schema.decodeUnknownEffect(AuthBootstrapInput);
const decodeCreatePairingCredentialInput = Schema.decodeUnknownEffect(
  AuthCreatePairingCredentialInput,
);
const decodeRevokePairingLinkInput = Schema.decodeUnknownEffect(AuthRevokePairingLinkInput);
const decodeRevokeClientSessionInput = Schema.decodeUnknownEffect(AuthRevokeClientSessionInput);

export const requireAuthenticatedRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  yield* serverAuth.authenticateHttpRequest(makeEffectAuthRequest(request));
});

export function isLegacyTokenAuthorized(input: {
  readonly config: ServerConfigShape;
  readonly url: URL;
}): boolean {
  const legacyToken = input.url.searchParams.get("token");
  return !input.config.authToken || legacyToken === input.config.authToken;
}

const readEffectJson = (request: HttpServerRequest.HttpServerRequest, message: string) =>
  request.json.pipe(
    Effect.mapError(
      (cause) =>
        new (class extends Error {
          override readonly cause = cause;
        })(message),
    ),
  );

export const authEffectRouteLayer = HttpRouter.add(
  "*",
  "/api/auth/*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const serverAuth = yield* ServerAuth;
    const sessions = yield* SessionCredentialService;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });
    const authRequest = makeEffectAuthRequest(request);
    const config = yield* ServerConfig;
    const ownerSession = Effect.gen(function* () {
      const legacyToken = url.searchParams.get("token");
      if (config.authToken && legacyToken === config.authToken) {
        return {
          sessionId: AuthSessionId.makeUnsafe("desktop-managed-local"),
          subject: "desktop-bootstrap",
          method: "bearer-session-token" as const,
          role: "owner" as const,
        };
      }
      const session = yield* serverAuth.authenticateHttpRequest(authRequest);
      if (session.role !== "owner") {
        return yield* Effect.fail({
          message: "Only owner sessions can manage network access.",
          status: 403 as const,
        });
      }
      return session;
    });

    if (request.method === "GET" && url.pathname === "/api/auth/session") {
      if (config.authToken && url.searchParams.get("token") === config.authToken) {
        return HttpServerResponse.jsonUnsafe({
          authenticated: true,
          auth: yield* serverAuth.getDescriptor(),
          role: "owner",
          sessionMethod: "bearer-session-token",
        });
      }
      const session = yield* serverAuth.getSessionState(authRequest);
      const renewal = session.authenticated
        ? yield* maybeRenewSessionCookie({
            cookieToken: authRequest.cookies[sessions.cookieName],
            sessionMethod: session.sessionMethod,
            expiresAtMs: session.expiresAt ? DateTime.toEpochMillis(session.expiresAt) : NaN,
            sessions,
          })
        : null;
      const websocketToken =
        session.authenticated && url.searchParams.get("includeWebSocketToken") === "1"
          ? yield* serverAuth
              .authenticateHttpRequest(authRequest)
              .pipe(Effect.flatMap(serverAuth.issueWebSocketToken))
          : null;
      return HttpServerResponse.jsonUnsafe(
        {
          ...(renewal ? { ...session, expiresAt: DateTime.toUtc(renewal.expiresAt) } : session),
          ...(websocketToken ? { websocketToken } : {}),
        },
        {
          headers: {
            "Cache-Control": "no-store",
            ...(renewal
              ? {
                  "Set-Cookie": encodeSessionCookie({
                    name: sessions.cookieName,
                    value: renewal.token,
                    expiresAt: renewal.expiresAt,
                  }),
                }
              : {}),
          },
        },
      );
    }

    if (request.method === "POST" && url.pathname === "/api/auth/bootstrap") {
      const payload = yield* readEffectJson(request, "Invalid bootstrap payload.").pipe(
        Effect.flatMap(decodeBootstrapInput),
        Effect.mapError((cause) => ({
          message: "Invalid bootstrap payload.",
          status: 400 as const,
          cause,
        })),
      );
      const result = yield* serverAuth.exchangeBootstrapCredential(payload.credential, {
        ...deriveAuthClientMetadata({
          headers: request.headers,
          remoteAddress: request.remoteAddress ?? null,
        }),
      });
      return HttpServerResponse.jsonUnsafe(result.response, {
        headers: {
          "Set-Cookie": encodeSessionCookie({
            name: sessions.cookieName,
            value: result.sessionToken,
            expiresAt: result.response.expiresAt,
          }),
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/bootstrap/bearer") {
      const payload = yield* readEffectJson(request, "Invalid bootstrap payload.").pipe(
        Effect.flatMap(decodeBootstrapInput),
        Effect.mapError((cause) => ({
          message: "Invalid bootstrap payload.",
          status: 400 as const,
          cause,
        })),
      );
      return HttpServerResponse.jsonUnsafe(
        yield* serverAuth.exchangeBootstrapCredentialForBearerSession(payload.credential, {
          ...deriveAuthClientMetadata({
            headers: request.headers,
            remoteAddress: request.remoteAddress ?? null,
          }),
        }),
      );
    }

    if (request.method === "POST" && url.pathname === "/api/auth/ws-token") {
      const session = yield* serverAuth.authenticateHttpRequest(authRequest);
      const result = yield* serverAuth.issueWebSocketToken(session);
      const renewal = yield* maybeRenewSessionCookie({
        cookieToken: authRequest.cookies[sessions.cookieName],
        sessionMethod: session.method,
        expiresAtMs: session.expiresAt ? DateTime.toEpochMillis(session.expiresAt) : NaN,
        sessions,
      });
      return HttpServerResponse.jsonUnsafe(
        result,
        renewal
          ? {
              headers: {
                "Set-Cookie": encodeSessionCookie({
                  name: sessions.cookieName,
                  value: renewal.token,
                  expiresAt: renewal.expiresAt,
                }),
              },
            }
          : undefined,
      );
    }

    if (request.method === "POST" && url.pathname === "/api/auth/pairing-token") {
      yield* ownerSession;
      const payload =
        Number(request.headers["content-length"] ?? "0") > 0
          ? yield* readEffectJson(request, "Invalid pairing credential payload.").pipe(
              Effect.flatMap(decodeCreatePairingCredentialInput),
              Effect.mapError((cause) => ({
                message: "Invalid pairing credential payload.",
                status: 400 as const,
                cause,
              })),
            )
          : {};
      return HttpServerResponse.jsonUnsafe(yield* serverAuth.issuePairingCredential(payload));
    }

    if (request.method === "GET" && url.pathname === "/api/auth/pairing-links") {
      yield* ownerSession;
      return HttpServerResponse.jsonUnsafe(yield* serverAuth.listPairingLinks());
    }

    if (request.method === "POST" && url.pathname === "/api/auth/pairing-links/revoke") {
      yield* ownerSession;
      const payload = yield* readEffectJson(request, "Invalid revoke pairing link payload.").pipe(
        Effect.flatMap(decodeRevokePairingLinkInput),
        Effect.mapError((cause) => ({
          message: "Invalid revoke pairing link payload.",
          status: 400 as const,
          cause,
        })),
      );
      return HttpServerResponse.jsonUnsafe({
        revoked: yield* serverAuth.revokePairingLink(payload.id),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/auth/clients") {
      const session = yield* ownerSession;
      return HttpServerResponse.jsonUnsafe(yield* serverAuth.listClientSessions(session.sessionId));
    }

    if (request.method === "POST" && url.pathname === "/api/auth/clients/revoke") {
      const session = yield* ownerSession;
      const payload = yield* readEffectJson(request, "Invalid revoke client payload.").pipe(
        Effect.flatMap(decodeRevokeClientSessionInput),
        Effect.mapError((cause) => ({
          message: "Invalid revoke client payload.",
          status: 400 as const,
          cause,
        })),
      );
      return HttpServerResponse.jsonUnsafe({
        revoked: yield* serverAuth.revokeClientSession(session.sessionId, payload.sessionId),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/clients/revoke-others") {
      const session = yield* ownerSession;
      return HttpServerResponse.jsonUnsafe({
        revokedCount: yield* serverAuth.revokeOtherClientSessions(session.sessionId),
      });
    }

    return HttpServerResponse.text("Not Found", { status: 404 });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          {
            error:
              error instanceof Error
                ? error.message
                : String((error as { message?: unknown }).message ?? error),
          },
          {
            status:
              typeof (error as { status?: unknown }).status === "number"
                ? (error as { status: number }).status
                : 500,
          },
        ),
      ),
    ),
  ),
);
