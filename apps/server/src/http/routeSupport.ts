import nodePath from "node:path";

import Mime from "@effect/platform-node/Mime";
import { Effect, FileSystem } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import type { ServerConfigShape } from "../config";
import { resolveCachedEditorIcon } from "../editorAppIcons";
import { isTrustedAppOrigin, normalizeCorsOrigin } from "../trustedOrigins";

export const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
export const SITE_FAVICON_CACHE_CONTROL_SUCCESS = "public, max-age=86400";
export const SITE_FAVICON_CACHE_CONTROL_FALLBACK = "public, max-age=3600";
export const EDITOR_ICON_CACHE_CONTROL_SUCCESS = "public, max-age=86400";

export const FALLBACK_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;

export const FALLBACK_SITE_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="site-favicon"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20M12 2a14.5 14.5 0 0 1 0 20M2 12h20"/></svg>`;

export interface HttpPayload {
  readonly statusCode: number;
  readonly contentType: string;
  readonly headers?: Record<string, string>;
  readonly body: string | Uint8Array;
}

function resolveEditorIconCacheDir(config: ServerConfigShape): string {
  return nodePath.join(config.stateDir, "app-icons");
}

function resolveEditorIconEnv(config: ServerConfigShape): NodeJS.ProcessEnv {
  return { ...process.env, HOME: config.homeDir };
}

// Shared by the Effect route and the legacy request listener so editor-icon
// behavior cannot drift between the two HTTP stacks.
export const resolveEditorIconHttpPayload = Effect.fn(function* (input: {
  readonly url: URL;
  readonly serverConfig: ServerConfigShape;
  readonly fileSystem: FileSystem.FileSystem;
}) {
  const editorId = input.url.searchParams.get("id");
  if (!editorId) {
    return {
      statusCode: 400,
      contentType: "text/plain",
      body: "Missing id parameter",
    } satisfies HttpPayload;
  }

  const icon = yield* Effect.promise(() =>
    resolveCachedEditorIcon({
      editorId,
      cacheDir: resolveEditorIconCacheDir(input.serverConfig),
      env: resolveEditorIconEnv(input.serverConfig),
    }),
  );
  if (!icon) {
    return {
      statusCode: 404,
      contentType: "text/plain",
      body: "Not Found",
    } satisfies HttpPayload;
  }

  const data = yield* input.fileSystem
    .readFile(icon.path)
    .pipe(Effect.catch(() => Effect.succeed(null)));
  if (!data) {
    return {
      statusCode: 404,
      contentType: "text/plain",
      body: "Not Found",
    } satisfies HttpPayload;
  }

  return {
    statusCode: 200,
    contentType: icon.contentType,
    headers: { "Cache-Control": EDITOR_ICON_CACHE_CONTROL_SUCCESS },
    body: data,
  } satisfies HttpPayload;
});

export function toEffectHttpResponse(payload: HttpPayload) {
  if (typeof payload.body === "string") {
    return HttpServerResponse.text(payload.body, {
      status: payload.statusCode,
      contentType: payload.contentType,
      ...(payload.headers ? { headers: payload.headers } : {}),
    });
  }

  return HttpServerResponse.uint8Array(payload.body, {
    status: payload.statusCode,
    contentType: payload.contentType,
    ...(payload.headers ? { headers: payload.headers } : {}),
  });
}

export function localPreviewCorsHeaders(input: {
  readonly config: ServerConfigShape;
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly url: URL;
}): Record<string, string> {
  const origin = normalizeCorsOrigin(input.request.headers.origin);
  if (
    !origin ||
    !isTrustedAppOrigin({ origin, requestOrigin: input.url.origin, config: input.config })
  ) {
    return {};
  }
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

// Streams a disk file as the response body instead of buffering it in memory.
export function streamedFileResponse(input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: string;
  readonly sizeBytes: number;
  readonly headers: Record<string, string>;
}): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.stream(input.fileSystem.stream(input.path), {
    status: 200,
    contentType: Mime.getType(input.path) ?? "application/octet-stream",
    contentLength: input.sizeBytes,
    headers: input.headers,
  });
}
