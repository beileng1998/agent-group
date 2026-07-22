import { ThreadId } from "@agent-group/contracts";
import { threadExportBlockedReason } from "@agent-group/shared/threadExport";
import { CODEX_VISUALIZATION_ROUTE_PATH } from "@agent-group/shared/codexVisualizations";
import { Effect, FileSystem, Option, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import {
  ATTACHMENTS_ROUTE_PREFIX,
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "../attachmentPaths";
import { resolveAttachmentPathById } from "../attachmentStore.ts";
import { authErrorResponse } from "../auth/http";
import { ServerConfig } from "../config";
import { LOCAL_IMAGE_ROUTE_PATH, resolveAllowedLocalPreviewFile } from "../localImageFiles.ts";
import { resolveCodexVisualizationArtifact } from "../codexVisualizations.ts";
import { threadArchiveChunks, threadArchiveFileName } from "../orchestration/exportThreadArchive";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { isLegacyTokenAuthorized, requireAuthenticatedRequest } from "./authRoutes";
import { localPreviewCorsHeaders, streamedFileResponse } from "./routeSupport";

export const threadExportEffectRouteLayer = HttpRouter.add(
  "GET",
  "/api/thread-export",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });

    const config = yield* ServerConfig;
    if (!isLegacyTokenAuthorized({ config, url })) {
      yield* requireAuthenticatedRequest;
    }

    const corsHeaders = localPreviewCorsHeaders({ config, request, url });
    const threadIdParam = url.searchParams.get("threadId")?.trim();
    if (!threadIdParam)
      return HttpServerResponse.text("Missing threadId parameter", {
        status: 400,
        headers: corsHeaders,
      });

    const snapshotQuery = yield* ProjectionSnapshotQuery;
    const threadOption = yield* snapshotQuery.getThreadDetailForExportById(
      ThreadId.makeUnsafe(threadIdParam),
    );
    if (Option.isNone(threadOption))
      return HttpServerResponse.text("Not Found", { status: 404, headers: corsHeaders });
    const thread = threadOption.value;

    const blockedReason = threadExportBlockedReason(thread);
    if (blockedReason !== null) {
      return HttpServerResponse.text(blockedReason, { status: 409, headers: corsHeaders });
    }

    const fileName = threadArchiveFileName({ title: thread.title, isoTimestamp: thread.updatedAt });
    return HttpServerResponse.stream(
      Stream.fromAsyncIterable(threadArchiveChunks(thread), (cause) => cause),
      {
        status: 200,
        contentType: "application/zip",
        headers: {
          "Content-Disposition": `attachment; filename="${fileName.replaceAll('"', "")}"`,
          "Cache-Control": "no-store",
          ...corsHeaders,
          "Access-Control-Expose-Headers": "Content-Disposition",
        },
      },
    );
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

export const localImageEffectRouteLayer = HttpRouter.add(
  "GET",
  LOCAL_IMAGE_ROUTE_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });

    const config = yield* ServerConfig;
    if (!isLegacyTokenAuthorized({ config, url })) {
      yield* requireAuthenticatedRequest;
    }

    const previewFile = yield* Effect.promise(() =>
      resolveAllowedLocalPreviewFile({
        requestedPath: url.searchParams.get("path"),
        cwd: url.searchParams.get("cwd"),
        allowAbsoluteLocalPreviewFile: true,
        previewGrant: url.searchParams.get("grant"),
      }).catch(() => null),
    );
    if (!previewFile) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const isDownload = url.searchParams.get("download") === "1";
    const safeFileName = previewFile.fileName.replaceAll('"', "");
    return streamedFileResponse({
      fileSystem,
      path: previewFile.path,
      sizeBytes: previewFile.sizeBytes,
      headers: {
        "Cache-Control": "private, max-age=60",
        ...localPreviewCorsHeaders({ config, request, url }),
        "X-Content-Type-Options": "nosniff",
        ...(isDownload ? { "Content-Disposition": `attachment; filename="${safeFileName}"` } : {}),
      },
    });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

export const codexVisualizationEffectRouteLayer = HttpRouter.add(
  "GET",
  CODEX_VISUALIZATION_ROUTE_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });

    const config = yield* ServerConfig;
    if (!isLegacyTokenAuthorized({ config, url })) {
      yield* requireAuthenticatedRequest;
    }
    const threadId = url.searchParams.get("threadId")?.trim();
    const messageId = url.searchParams.get("messageId")?.trim();
    const fileName = url.searchParams.get("file")?.trim();
    if (!threadId || !messageId || !fileName) {
      return HttpServerResponse.text("Missing visualization parameters", { status: 400 });
    }

    const artifact = yield* Effect.promise(() =>
      resolveCodexVisualizationArtifact({
        stateDir: config.stateDir,
        threadId,
        messageId,
        fileName,
      }),
    );
    if (!artifact) return HttpServerResponse.text("Not Found", { status: 404 });
    const fileSystem = yield* FileSystem.FileSystem;
    const fragment = yield* fileSystem
      .readFileString(artifact.path)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (fragment === null) return HttpServerResponse.text("Not Found", { status: 404 });

    return HttpServerResponse.text(fragment, {
      status: 200,
      contentType: "text/plain; charset=utf-8",
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Security-Policy": "default-src 'none'",
        "X-Content-Type-Options": "nosniff",
        ...localPreviewCorsHeaders({ config, request, url }),
      },
    });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

export const attachmentsEffectRouteLayer = HttpRouter.add(
  "GET",
  `${ATTACHMENTS_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (!url) return HttpServerResponse.text("Bad Request", { status: 400 });

    const config = yield* ServerConfig;
    if (!isLegacyTokenAuthorized({ config, url })) {
      yield* requireAuthenticatedRequest;
    }

    const rawRelativePath = url.pathname.slice(ATTACHMENTS_ROUTE_PREFIX.length);
    const normalizedRelativePath = normalizeAttachmentRelativePath(rawRelativePath);
    if (!normalizedRelativePath) {
      return HttpServerResponse.text("Invalid attachment path", { status: 400 });
    }

    const isIdLookup =
      !normalizedRelativePath.includes("/") && !normalizedRelativePath.includes(".");
    const filePath = isIdLookup
      ? resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: normalizedRelativePath,
        })
      : resolveAttachmentRelativePath({
          attachmentsDir: config.attachmentsDir,
          relativePath: normalizedRelativePath,
        });
    if (!filePath) {
      return HttpServerResponse.text(isIdLookup ? "Not Found" : "Invalid attachment path", {
        status: isIdLookup ? 404 : 400,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    return streamedFileResponse({
      fileSystem,
      path: filePath,
      sizeBytes: Number(fileInfo.size),
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    });
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);
