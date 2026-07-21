import {
  MessageId,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type ProviderRuntimeEvent,
  STUDIO_OUTPUTS_ACTIVITY_KIND,
  type ThreadId,
  type TurnId,
} from "@agent-group/contracts";
import { Cache, Cause, Effect, Option } from "effect";

import { generatedImageMarkdown, isCodexGeneratedImageArtifact } from "../codexGeneratedImages.ts";
import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils.ts";
import { copyAndAttributeStudioGeneratedImage } from "../studioGeneratedImages.ts";
import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine.ts";
import type {
  ProjectionGeneratedImageActivityRecord,
  ProjectionSnapshotQueryShape,
} from "./Services/ProjectionSnapshotQuery.ts";
import type { ProviderRuntimeBufferState } from "./providerRuntimeBufferState.ts";
import { providerCommandId, providerTurnKey } from "./providerRuntimeIngestionValues.ts";

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function collectPersistedGeneratedImagePaths(
  records: ReadonlyArray<ProjectionGeneratedImageActivityRecord>,
): string[] {
  const studioDisplayPathBySourcePath = new Map<string, string>();
  for (const record of records) {
    if (record.kind !== STUDIO_OUTPUTS_ACTIVITY_KIND) continue;
    const generatedImage = asObject(asObject(asObject(record.payload)?.data)?.generatedImage);
    const sourcePath = asString(generatedImage?.sourcePath)?.trim();
    const fullPath = asString(generatedImage?.fullPath)?.trim();
    if (sourcePath && fullPath) studioDisplayPathBySourcePath.set(sourcePath, fullPath);
  }
  const paths: string[] = [];
  const seenPaths = new Set<string>();
  const representedSourcePaths = new Set<string>();
  const addPath = (path: string) => {
    if (!seenPaths.has(path)) {
      seenPaths.add(path);
      paths.push(path);
    }
  };
  for (const record of records) {
    if (record.kind !== "tool.completed") continue;
    const payload = asObject(record.payload);
    if (payload?.itemType !== "image_generation") continue;
    const artifact = isCodexGeneratedImageArtifact(payload.data) ? payload.data : undefined;
    if (!artifact) continue;
    representedSourcePaths.add(artifact.path);
    addPath(studioDisplayPathBySourcePath.get(artifact.path) ?? artifact.path);
  }
  for (const [sourcePath, fullPath] of studioDisplayPathBySourcePath) {
    if (!representedSourcePaths.has(sourcePath)) addPath(fullPath);
  }
  return paths;
}

export function makeProviderRuntimeGeneratedImages(input: {
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
  readonly state: ProviderRuntimeBufferState;
  readonly getProjectShell: (
    thread: Pick<OrchestrationThread, "projectId">,
  ) => Effect.Effect<OrchestrationProjectShell | undefined>;
}) {
  const appendGeneratedImagesToAssistantMessage = (params: {
    readonly event: ProviderRuntimeEvent;
    readonly threadId: ThreadId;
    readonly targetMessage:
      | Pick<OrchestrationThread["messages"][number], "id" | "text" | "streaming">
      | undefined;
    readonly newMessageId: MessageId;
    readonly imagePaths: ReadonlyArray<string>;
    readonly turnId?: TurnId;
    readonly createdAt: string;
  }) =>
    Effect.gen(function* () {
      const targetMessageId = params.targetMessage?.id ?? params.newMessageId;
      const targetMessageText = params.targetMessage?.text ?? "";
      const missingMarkdown: string[] = [];
      for (const imagePath of params.imagePaths) {
        const markdown = generatedImageMarkdown(imagePath);
        if (
          targetMessageText.includes(imagePath) ||
          targetMessageText.includes(markdown) ||
          missingMarkdown.includes(markdown)
        ) {
          continue;
        }
        missingMarkdown.push(markdown);
      }
      let dispatchedDelta = false;
      if (missingMarkdown.length > 0) {
        const joined = missingMarkdown.join("\n\n");
        yield* input.orchestrationEngine.dispatch({
          type: "thread.message.assistant.delta",
          commandId: providerCommandId(params.event, "generated-image-delta"),
          threadId: params.threadId,
          messageId: targetMessageId,
          delta: targetMessageText.trim().length > 0 ? `\n\n${joined}` : joined,
          ...(params.turnId ? { turnId: params.turnId } : {}),
          createdAt: params.createdAt,
        });
        dispatchedDelta = true;
      }
      if (dispatchedDelta || !params.targetMessage || params.targetMessage.streaming) {
        yield* input.orchestrationEngine.dispatch({
          type: "thread.message.assistant.complete",
          commandId: providerCommandId(params.event, "generated-image-complete"),
          threadId: params.threadId,
          messageId: targetMessageId,
          ...(params.turnId ? { turnId: params.turnId } : {}),
          createdAt: params.createdAt,
        });
      }
    });

  const rememberPendingGeneratedImage = (threadId: ThreadId, turnId: TurnId, imagePath: string) =>
    Cache.getOption(
      input.state.pendingGeneratedImagesByTurnKey,
      providerTurnKey(threadId, turnId),
    ).pipe(
      Effect.flatMap((existingPaths) => {
        const paths = Option.getOrElse(existingPaths, (): ReadonlyArray<string> => []);
        if (paths.includes(imagePath) || paths.length >= 32) return Effect.void;
        return Cache.set(
          input.state.pendingGeneratedImagesByTurnKey,
          providerTurnKey(threadId, turnId),
          [...paths, imagePath],
        );
      }),
    );

  const takePendingGeneratedImages = (threadId: ThreadId, turnId: TurnId) =>
    Cache.getOption(
      input.state.pendingGeneratedImagesByTurnKey,
      providerTurnKey(threadId, turnId),
    ).pipe(
      Effect.flatMap((paths) =>
        Cache.invalidate(
          input.state.pendingGeneratedImagesByTurnKey,
          providerTurnKey(threadId, turnId),
        ).pipe(Effect.as(Option.getOrElse(paths, (): ReadonlyArray<string> => []))),
      ),
    );

  const flushPendingGeneratedImagesForTurn = (params: {
    readonly event: ProviderRuntimeEvent;
    readonly thread: OrchestrationThread;
    readonly turnId: TurnId;
    readonly createdAt: string;
  }) =>
    Effect.gen(function* () {
      const cached = yield* takePendingGeneratedImages(params.thread.id, params.turnId);
      const persisted = yield* input.projectionSnapshotQuery
        .listGeneratedImageActivitiesByTurn(params.thread.id, params.turnId)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to recover persisted generated-image references", {
              threadId: params.thread.id,
              turnId: params.turnId,
              cause: Cause.pretty(cause),
            }).pipe(Effect.as<ReadonlyArray<ProjectionGeneratedImageActivityRecord>>([])),
          ),
        );
      const imagePaths = [
        ...new Set([...cached, ...collectPersistedGeneratedImagePaths(persisted)]),
      ];
      if (imagePaths.length === 0) return;
      const terminalMessage = params.thread.messages
        .filter((message) => message.role === "assistant" && message.turnId === params.turnId)
        .toSorted(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
        )[0];
      yield* appendGeneratedImagesToAssistantMessage({
        ...params,
        threadId: params.thread.id,
        targetMessage: terminalMessage,
        newMessageId: MessageId.makeUnsafe(`assistant:image:${params.turnId}`),
        imagePaths,
      });
    });

  const materializeStudioGeneratedImage = (params: {
    readonly event: ProviderRuntimeEvent;
    readonly thread: OrchestrationThread;
    readonly imagePath: string;
    readonly turnId: TurnId | undefined;
    readonly createdAt: string;
  }) =>
    Effect.gen(function* () {
      const project = yield* input.getProjectShell(params.thread);
      if (!project || project.kind !== "studio") return null;
      const workspaceRoot = resolveThreadWorkspaceCwd({
        thread: params.thread,
        projects: [project],
      });
      if (!workspaceRoot) return null;
      return yield* copyAndAttributeStudioGeneratedImage({
        orchestrationEngine: input.orchestrationEngine,
        sourcePath: params.imagePath,
        workspaceRoot,
        threadId: params.thread.id,
        turnId: params.turnId,
        eventId: params.event.eventId,
        createdAt: params.createdAt,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("failed to copy generated image into Studio workspace", {
              threadId: params.thread.id,
              imagePath: params.imagePath,
              cause: Cause.pretty(cause),
            }).pipe(Effect.as(null)),
      ),
    );

  return {
    appendGeneratedImagesToAssistantMessage,
    rememberPendingGeneratedImage,
    flushPendingGeneratedImagesForTurn,
    materializeStudioGeneratedImage,
  };
}
