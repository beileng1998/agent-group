import {
  RemoteCommandRequest,
  RemoteCommandResult,
  RemoteEventBatch,
  ThreadId,
  type OrchestrationEvent,
  type RemoteEventBatch as RemoteEventBatchValue,
} from "@agent-group/contracts";
import { Effect, Fiber, FileSystem, Layer, Option, Path, Schema, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { authErrorResponse } from "../auth/http";
import { ServerConfig } from "../config";
import { makeOrchestrationCommandDispatcher } from "../orchestration/commandDispatcher";
import {
  isShellRelevantEvent,
  isThreadDetailEvent,
  makeShellStreamProjector,
} from "../orchestration/remoteEventProjection";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { ServerRuntimeStartup } from "../serverRuntimeStartup";
import { makeWorkspaceSupport } from "../workspace/workspaceSupport";
import { isLegacyTokenAuthorized, requireAuthenticatedRequest } from "./authRoutes";
import { prepareCompressedResponseBody } from "./staticAssetResponse";

const MAX_EVENT_BATCH_SIZE = 256;
const EVENT_WAIT_MS = 20_000;
const EVENT_COALESCE_MS = 120;
const PROJECTION_POLL_MS = 25;
const PROJECTION_WAIT_ATTEMPTS = 20;
const decodeCommandRequest = Schema.decodeUnknownEffect(RemoteCommandRequest);
const decodeThreadId = Schema.decodeUnknownOption(ThreadId);

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function jsonError(error: unknown, status: number, fallback: string) {
  return HttpServerResponse.jsonUnsafe(
    { error: errorMessage(error, fallback) },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

const authenticateRemoteRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request);
  if (!url) return yield* Effect.fail(new Error("Invalid request URL."));
  const config = yield* ServerConfig;
  if (!isLegacyTokenAuthorized({ config, url })) yield* requireAuthenticatedRequest;
  return { request, url, config };
});

function compressedJsonResponse(
  value: unknown,
  acceptEncoding: string | ReadonlyArray<string> | undefined,
) {
  return Effect.gen(function* () {
    const json = JSON.stringify(value);
    const prepared = yield* Effect.promise(() =>
      prepareCompressedResponseBody(new TextEncoder().encode(json), acceptEncoding),
    );
    return HttpServerResponse.uint8Array(prepared.body, {
      status: 200,
      contentType: "application/json; charset=utf-8",
      headers: {
        "Cache-Control": "private, no-store",
        ...prepared.headers,
      },
    });
  });
}

function readEventsAfter(
  engine: typeof OrchestrationEngineService.Service,
  afterSequence: number,
) {
  return Stream.runCollect(
    engine.readEvents(afterSequence).pipe(Stream.take(MAX_EVENT_BATCH_SIZE + 1)),
  ).pipe(Effect.map((events) => Array.from(events)));
}

function waitForNewEvent(
  engine: typeof OrchestrationEngineService.Service,
  afterSequence: number,
) {
  return Stream.runHead(
    engine.streamDomainEvents.pipe(Stream.filter((event) => event.sequence > afterSequence)),
  ).pipe(Effect.timeoutOption(EVENT_WAIT_MS));
}

function readEventsWithLongPoll(
  engine: typeof OrchestrationEngineService.Service,
  afterSequence: number,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      // Subscribe before reading persistence so an event cannot land in the
      // gap between an empty read and the live-stream subscription.
      const waiter = yield* Effect.forkScoped(waitForNewEvent(engine, afterSequence));
      let events = yield* readEventsAfter(engine, afterSequence);
      if (events.length === 0) {
        const signal = yield* Fiber.join(waiter);
        if (Option.isNone(signal) || Option.isNone(signal.value)) return events;
      } else {
        yield* Fiber.interrupt(waiter).pipe(Effect.ignore);
        if (events.length > MAX_EVENT_BATCH_SIZE) return events;
      }
      yield* Effect.sleep(EVENT_COALESCE_MS);
      events = yield* readEventsAfter(engine, afterSequence);
      return events;
    }),
  );
}

function parseEventCursor(url: URL): number | null {
  const raw = url.searchParams.get("after") ?? "0";
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseEventThreadId(url: URL): ThreadId | null | undefined {
  const raw = url.searchParams.get("threadId");
  if (raw === null) return null;
  const decoded = decodeThreadId(raw);
  return Option.isSome(decoded) ? decoded.value : undefined;
}

function waitForProjectionSequence(
  projectionSnapshotQuery: typeof ProjectionSnapshotQuery.Service,
  targetSequence: number,
) {
  return Effect.gen(function* () {
    let snapshotSequence = 0;
    for (let attempt = 0; attempt < PROJECTION_WAIT_ATTEMPTS; attempt += 1) {
      snapshotSequence = (yield* projectionSnapshotQuery.getSnapshotSequence()).snapshotSequence;
      if (snapshotSequence >= targetSequence) break;
      yield* Effect.sleep(PROJECTION_POLL_MS);
    }
    return snapshotSequence;
  });
}

export function makeRemoteEventBatch(input: {
  readonly afterSequence: number;
  readonly events: ReadonlyArray<OrchestrationEvent>;
  readonly threadId: ThreadId | null;
  readonly projectionSnapshotQuery: typeof ProjectionSnapshotQuery.Service;
}) {
  return Effect.gen(function* () {
    const hasMore = input.events.length > MAX_EVENT_BATCH_SIZE;
    const events = input.events.slice(0, MAX_EVENT_BATCH_SIZE);
    const nextSequence = events.reduce(
      (latest, event) => Math.max(latest, event.sequence),
      input.afterSequence,
    );
    const projectShellEvent = makeShellStreamProjector(input.projectionSnapshotQuery);
    const shellEvents = yield* Effect.forEach(
      events.filter(isShellRelevantEvent),
      projectShellEvent,
      { concurrency: 8 },
    ).pipe(Effect.map((items) => items.flatMap((item) => Option.toArray(item))));
    const threadEvents =
      input.threadId === null
        ? []
        : events.filter(
            (event) =>
              event.aggregateKind === "thread" &&
              event.aggregateId === input.threadId &&
              isThreadDetailEvent(event),
          );
    return {
      version: 1,
      nextSequence,
      hasMore,
      shellEvents,
      threadEvents,
    } satisfies RemoteEventBatchValue;
  });
}

const remoteCommandEffectRouteLayer = HttpRouter.add(
  "POST",
  "/api/remote-command",
  Effect.gen(function* () {
    const { request, config } = yield* authenticateRemoteRequest;
    const fileSystem = yield* FileSystem.FileSystem;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const path = yield* Path.Path;
    const runtimeStartup = yield* ServerRuntimeStartup;
    const workspaceSupport = makeWorkspaceSupport({ config, fileSystem, path });
    const dispatchCommand = makeOrchestrationCommandDispatcher({
      config,
      fileSystem,
      orchestrationEngine,
      path,
      runtimeStartup,
      workspaceSupport,
    });

    return yield* request.json.pipe(
      Effect.flatMap(decodeCommandRequest),
      Effect.flatMap(({ command }) => dispatchCommand(command)),
      Effect.flatMap((result) => Schema.encodeEffect(RemoteCommandResult)(result)),
      Effect.map((result) =>
        HttpServerResponse.jsonUnsafe(result, {
          status: 200,
          headers: { "Cache-Control": "no-store" },
        }),
      ),
      Effect.catch((error) =>
        Effect.succeed(jsonError(error, 400, "Failed to dispatch remote command.")),
      ),
    );
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

const remoteEventsEffectRouteLayer = HttpRouter.add(
  "GET",
  "/api/remote-events",
  Effect.gen(function* () {
    const { request, url } = yield* authenticateRemoteRequest;
    const afterSequence = parseEventCursor(url);
    const threadId = parseEventThreadId(url);
    if (afterSequence === null || threadId === undefined) {
      return HttpServerResponse.text("Invalid remote event cursor.", { status: 400 });
    }
    const engine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

    return yield* Effect.gen(function* () {
      const events = yield* readEventsWithLongPoll(engine, afterSequence);
      const targetEvent = events[Math.min(events.length, MAX_EVENT_BATCH_SIZE) - 1];
      const projectionSequence = targetEvent
        ? yield* waitForProjectionSequence(projectionSnapshotQuery, targetEvent.sequence)
        : afterSequence;
      // Never advance the durable HTTP cursor past projections used to build
      // shell upserts. A temporarily lagging projector will be retried instead
      // of turning a missing shell row into a permanently dropped update.
      const projectionSafeEvents = events.filter(
        (event) => event.sequence <= projectionSequence,
      );
      const batch = yield* makeRemoteEventBatch({
        afterSequence,
        events: projectionSafeEvents,
        threadId,
        projectionSnapshotQuery,
      });
      const encoded = yield* Schema.encodeEffect(RemoteEventBatch)(batch);
      return yield* compressedJsonResponse(encoded, request.headers["accept-encoding"]);
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(jsonError(error, 500, "Failed to read remote events.")),
      ),
    );
  }).pipe(Effect.catchTag("AuthError", (error) => Effect.succeed(authErrorResponse(error)))),
);

export const remoteOrchestrationEffectRouteLayer = Layer.mergeAll(
  remoteCommandEffectRouteLayer,
  remoteEventsEffectRouteLayer,
);
