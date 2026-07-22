import { createHash } from "node:crypto";

import {
  RemoteBootstrapSnapshot,
  ThreadId,
  type RemoteBootstrapSnapshot as RemoteBootstrapSnapshotValue,
} from "@agent-group/contracts";
import { Effect, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { queryAgentGroupSession } from "../agentGroup/sessionQuery";
import { authErrorResponse } from "../auth/http";
import { ServerConfig } from "../config";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { isLegacyTokenAuthorized, requireAuthenticatedRequest } from "./authRoutes";
import { prepareCompressedResponseBody } from "./staticAssetResponse";

const decodeThreadId = Schema.decodeUnknownOption(ThreadId);

function snapshotEtag(json: string): string {
  return `"${createHash("sha256").update(json).digest("base64url").slice(0, 24)}"`;
}

export const remoteBootstrapEffectRouteLayer = HttpRouter.add(
  "GET",
  "/api/remote-bootstrap",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });
    const config = yield* ServerConfig;
    if (!isLegacyTokenAuthorized({ config, url })) yield* requireAuthenticatedRequest;

    const rawThreadId = url.searchParams.get("threadId");
    const decodedThreadId = rawThreadId === null ? Option.none() : decodeThreadId(rawThreadId);
    if (rawThreadId !== null && Option.isNone(decodedThreadId)) {
      return HttpServerResponse.text("Invalid threadId", { status: 400 });
    }

    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const shell = yield* projectionSnapshotQuery.getShellSnapshot();
    let thread: RemoteBootstrapSnapshotValue["thread"] = null;
    let agentGroupSession: RemoteBootstrapSnapshotValue["agentGroupSession"] = null;
    if (Option.isSome(decodedThreadId)) {
      const threadId = decodedThreadId.value;
      const [threadOption, sessionOption] = yield* Effect.all(
        [
          projectionSnapshotQuery.getThreadDetailSnapshotById(threadId),
          queryAgentGroupSession(threadId).pipe(Effect.option),
        ],
        { concurrency: "unbounded" },
      );
      thread = Option.getOrNull(threadOption);
      agentGroupSession = Option.getOrNull(sessionOption);
    }

    const snapshot = {
      version: 1,
      generatedAt: new Date().toISOString(),
      shell,
      thread,
      agentGroupSession,
    } satisfies RemoteBootstrapSnapshotValue;
    // Encode once through the shared schema before this becomes a durable browser cache format.
    const encoded = yield* Schema.encodeEffect(RemoteBootstrapSnapshot)(snapshot);
    const json = JSON.stringify(encoded);
    const etag = snapshotEtag(
      JSON.stringify({
        shell: encoded.shell,
        thread: encoded.thread,
        agentGroupSession: encoded.agentGroupSession,
      }),
    );
    const baseHeaders = {
      "Cache-Control": "private, no-cache",
      ETag: etag,
    };
    if (request.headers["if-none-match"] === etag) {
      return HttpServerResponse.empty({ status: 304, headers: baseHeaders });
    }

    const prepared = yield* Effect.promise(() =>
      prepareCompressedResponseBody(
        new TextEncoder().encode(json),
        request.headers["accept-encoding"],
      ),
    );
    return HttpServerResponse.uint8Array(prepared.body, {
      status: 200,
      contentType: "application/json; charset=utf-8",
      headers: { ...baseHeaders, ...prepared.headers },
    });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);
