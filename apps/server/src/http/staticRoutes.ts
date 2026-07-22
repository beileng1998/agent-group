import Mime from "@effect/platform-node/Mime";
import { Effect, FileSystem, Path } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerConfig } from "../config";
import { prepareStaticAsset } from "./staticAssetResponse";

export const staticAndDevEffectRouteLayer = HttpRouter.add(
  "GET",
  "*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });

    const config = yield* ServerConfig;
    if (config.devUrl) {
      return HttpServerResponse.redirect(config.devUrl.toString(), { status: 302 });
    }

    if (!config.staticDir) {
      return HttpServerResponse.text("No static directory configured and no dev URL set.", {
        status: 503,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const staticRoot = path.resolve(config.staticDir);
    const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const rawRelativePath = requestPath.replace(/^[/\\]+/, "");
    const relativePath = path.normalize(rawRelativePath).replace(/^[/\\]+/, "");
    if (
      relativePath.length === 0 ||
      rawRelativePath.startsWith("..") ||
      relativePath.startsWith("..") ||
      relativePath.includes("\0")
    ) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const isWithinStaticRoot = (candidate: string) =>
      candidate === staticRoot ||
      candidate.startsWith(staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`);

    let filePath = path.resolve(staticRoot, relativePath);
    if (!isWithinStaticRoot(filePath)) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }
    if (!path.extname(filePath)) {
      filePath = path.resolve(filePath, "index.html");
      if (!isWithinStaticRoot(filePath)) {
        return HttpServerResponse.text("Invalid static file path", { status: 400 });
      }
    }

    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      const indexPath = path.resolve(staticRoot, "index.html");
      const indexInfo = yield* fileSystem
        .stat(indexPath)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      const indexData = yield* fileSystem
        .readFile(indexPath)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (!indexData) return HttpServerResponse.text("Not Found", { status: 404 });
      const contentType = "text/html; charset=utf-8";
      const version = `${String(indexInfo?.size ?? indexData.byteLength)}:${indexInfo?.mtime?.getTime() ?? 0}`;
      const prepared = yield* Effect.promise(() =>
        prepareStaticAsset({
          pathname: "/index.html",
          filePath: indexPath,
          version,
          contentType,
          acceptEncoding: request.headers["accept-encoding"],
          data: indexData,
        }),
      );
      return HttpServerResponse.uint8Array(prepared.body, {
        status: 200,
        contentType,
        headers: prepared.headers,
      });
    }

    const data = yield* fileSystem
      .readFile(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!data) return HttpServerResponse.text("Internal Server Error", { status: 500 });
    const contentType = Mime.getType(filePath) ?? "application/octet-stream";
    const prepared = yield* Effect.promise(() =>
      prepareStaticAsset({
        pathname: url.pathname,
        filePath,
        version: `${String(fileInfo.size)}:${fileInfo.mtime?.getTime() ?? 0}`,
        contentType,
        acceptEncoding: request.headers["accept-encoding"],
        data,
      }),
    );
    return HttpServerResponse.uint8Array(prepared.body, {
      status: 200,
      contentType,
      headers: prepared.headers,
    });
  }),
);
