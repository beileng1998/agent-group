import type { OrchestrationEvent, ThreadMarker } from "@agent-group/contracts";
import {
  addThreadMarker,
  removeThreadMarker,
  setThreadMarkerColor,
  setThreadMarkerDone,
  setThreadMarkerLabel,
  setThreadMarkerNote,
} from "@agent-group/shared/threadMarkers";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError } from "../../../persistence/Errors.ts";
import { ProjectionThreadRepository } from "../../../persistence/Services/ProjectionThreads.ts";

export const makeThreadHighlightProjection = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projectionThreadRepository = yield* ProjectionThreadRepository;

  const upsertHighlight = (threadId: string, marker: ThreadMarker) => sql`
    INSERT INTO projection_thread_highlights (
      marker_id, thread_id, message_id, start_offset, end_offset, selected_text,
      prefix, suffix, style, color, note, legacy_label, legacy_done, created_at, updated_at
    ) VALUES (
      ${marker.id}, ${threadId}, ${marker.messageId}, ${marker.startOffset}, ${marker.endOffset},
      ${marker.selectedText}, ${marker.prefix ?? ""}, ${marker.suffix ?? ""}, ${marker.style},
      ${marker.color}, ${marker.note ?? null}, ${marker.label ?? null}, ${marker.done ? 1 : 0},
      ${marker.createdAt}, ${marker.updatedAt}
    )
    ON CONFLICT(marker_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      message_id = excluded.message_id,
      start_offset = excluded.start_offset,
      end_offset = excluded.end_offset,
      selected_text = excluded.selected_text,
      prefix = excluded.prefix,
      suffix = excluded.suffix,
      style = excluded.style,
      color = excluded.color,
      note = excluded.note,
      legacy_label = excluded.legacy_label,
      legacy_done = excluded.legacy_done,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `;

  const replaceHighlightsForThread = (threadId: string, markers: readonly ThreadMarker[]) =>
    Effect.gen(function* () {
      yield* sql`DELETE FROM projection_thread_highlights WHERE thread_id = ${threadId}`;
      yield* Effect.forEach(markers, (marker) => upsertHighlight(threadId, marker), {
        concurrency: 1,
      });
    });

  const applyMarkerEvent = (event: OrchestrationEvent) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.marker-added": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) return true;
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            threadMarkers: addThreadMarker(existingRow.value.threadMarkers, event.payload.marker),
            updatedAt: event.payload.updatedAt,
          });
          yield* upsertHighlight(event.payload.threadId, event.payload.marker);
          return true;
        }
        case "thread.marker-removed": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) return true;
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            threadMarkers: removeThreadMarker(
              existingRow.value.threadMarkers,
              event.payload.markerId,
            ),
            updatedAt: event.payload.updatedAt,
          });
          yield* sql`
            DELETE FROM projection_thread_highlights
            WHERE marker_id = ${event.payload.markerId}
          `;
          return true;
        }
        case "thread.marker-done-set": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) return true;
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            threadMarkers: setThreadMarkerDone(
              existingRow.value.threadMarkers,
              event.payload.markerId,
              event.payload.done,
              event.payload.updatedAt,
            ),
            updatedAt: event.payload.updatedAt,
          });
          yield* sql`
            UPDATE projection_thread_highlights
            SET legacy_done = ${event.payload.done ? 1 : 0}, updated_at = ${event.payload.updatedAt}
            WHERE marker_id = ${event.payload.markerId}
          `;
          return true;
        }
        case "thread.marker-label-set": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) return true;
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            threadMarkers: setThreadMarkerLabel(
              existingRow.value.threadMarkers,
              event.payload.markerId,
              event.payload.label,
              event.payload.updatedAt,
            ),
            updatedAt: event.payload.updatedAt,
          });
          yield* sql`
            UPDATE projection_thread_highlights
            SET legacy_label = ${event.payload.label}, updated_at = ${event.payload.updatedAt}
            WHERE marker_id = ${event.payload.markerId}
          `;
          return true;
        }
        case "thread.marker-color-set": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) return true;
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            threadMarkers: setThreadMarkerColor(
              existingRow.value.threadMarkers,
              event.payload.markerId,
              event.payload.color,
              event.payload.updatedAt,
            ),
            updatedAt: event.payload.updatedAt,
          });
          yield* sql`
            UPDATE projection_thread_highlights
            SET color = ${event.payload.color}, updated_at = ${event.payload.updatedAt}
            WHERE marker_id = ${event.payload.markerId}
          `;
          return true;
        }
        case "thread.marker-note-set": {
          const existingRow = yield* projectionThreadRepository.getById({
            threadId: event.payload.threadId,
          });
          if (Option.isNone(existingRow)) return true;
          yield* projectionThreadRepository.upsert({
            ...existingRow.value,
            threadMarkers: setThreadMarkerNote(
              existingRow.value.threadMarkers,
              event.payload.markerId,
              event.payload.note,
              event.payload.updatedAt,
            ),
            updatedAt: event.payload.updatedAt,
          });
          yield* sql`
            UPDATE projection_thread_highlights
            SET note = ${event.payload.note}, updated_at = ${event.payload.updatedAt}
            WHERE marker_id = ${event.payload.markerId}
          `;
          return true;
        }
        default:
          return false;
      }
    }).pipe(
      Effect.catchTag("SqlError", (cause) =>
        Effect.fail(toPersistenceSqlError("ProjectionPipeline.highlights:query")(cause)),
      ),
    );

  return { applyMarkerEvent, replaceHighlightsForThread };
});
