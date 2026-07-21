import { EDITOR_ICON_ROUTE_PATH } from "@agent-group/shared/editorIcons";
import { Effect, FileSystem } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { authErrorResponse } from "../auth/http";
import { ServerConfig } from "../config";
import { ProjectFaviconResolver } from "../project/Services/ProjectFaviconResolver";
import { resolveFavicon, tryParseHost } from "../siteFaviconCache";
import { isLegacyTokenAuthorized, requireAuthenticatedRequest } from "./authRoutes";
import {
  FALLBACK_FAVICON_SVG,
  FALLBACK_SITE_FAVICON_SVG,
  PROJECT_FAVICON_CACHE_CONTROL,
  resolveEditorIconHttpPayload,
  SITE_FAVICON_CACHE_CONTROL_FALLBACK,
  SITE_FAVICON_CACHE_CONTROL_SUCCESS,
  toEffectHttpResponse,
} from "./routeSupport";

export const projectFaviconEffectRouteLayer = HttpRouter.add(
  "GET",
  "/api/project-favicon",
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest.pipe(
      Effect.catchTag("AuthError", (error) => Effect.fail(error)),
    );
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });
    const projectCwd = url.searchParams.get("cwd");
    if (!projectCwd) return HttpServerResponse.text("Missing cwd parameter", { status: 400 });
    const resolver = yield* ProjectFaviconResolver;
    const faviconPath = yield* resolver.resolvePath(projectCwd);
    if (!faviconPath) {
      if (url.searchParams.get("fallback") === "none")
        return HttpServerResponse.empty({ status: 204 });
      return HttpServerResponse.text(FALLBACK_FAVICON_SVG, {
        status: 200,
        contentType: "image/svg+xml",
        headers: { "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL },
      });
    }
    return yield* HttpServerResponse.file(faviconPath, {
      status: 200,
      headers: { "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL },
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

export const siteFaviconEffectRouteLayer = HttpRouter.add(
  "GET",
  "/api/site-favicon",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });

    const config = yield* ServerConfig;
    if (!isLegacyTokenAuthorized({ config, url })) {
      yield* requireAuthenticatedRequest;
    }

    const domainParam = url.searchParams.get("domain") ?? url.searchParams.get("url");
    if (!domainParam) return HttpServerResponse.text("Missing domain parameter", { status: 400 });
    const host = tryParseHost(domainParam);
    if (!host) return HttpServerResponse.text("Invalid domain", { status: 400 });

    const favicon = yield* Effect.promise(() => resolveFavicon(host));
    if (!favicon.bytes) {
      return HttpServerResponse.text(FALLBACK_SITE_FAVICON_SVG, {
        status: 200,
        contentType: "image/svg+xml",
        headers: { "Cache-Control": SITE_FAVICON_CACHE_CONTROL_FALLBACK },
      });
    }
    return HttpServerResponse.uint8Array(favicon.bytes, {
      status: 200,
      contentType: favicon.contentType ?? "image/x-icon",
      headers: { "Cache-Control": SITE_FAVICON_CACHE_CONTROL_SUCCESS },
    });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

export const editorIconEffectRouteLayer = HttpRouter.add(
  "GET",
  EDITOR_ICON_ROUTE_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });

    const config = yield* ServerConfig;
    if (!isLegacyTokenAuthorized({ config, url })) {
      yield* requireAuthenticatedRequest;
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const payload = yield* resolveEditorIconHttpPayload({
      url,
      serverConfig: config,
      fileSystem,
    });
    return toEffectHttpResponse(payload);
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);
