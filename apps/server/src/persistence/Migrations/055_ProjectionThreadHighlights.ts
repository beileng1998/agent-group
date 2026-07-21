import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_highlights (
      marker_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      selected_text TEXT NOT NULL,
      prefix TEXT NOT NULL DEFAULT '',
      suffix TEXT NOT NULL DEFAULT '',
      style TEXT NOT NULL,
      color TEXT NOT NULL,
      note TEXT,
      legacy_label TEXT,
      legacy_done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_highlights_thread_updated
    ON projection_thread_highlights(thread_id, updated_at DESC, marker_id DESC)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_highlights_updated
    ON projection_thread_highlights(updated_at DESC, marker_id DESC)
  `;

  yield* sql`
    UPDATE projection_threads
    SET thread_markers_json = (
      SELECT json_group_array(json(item))
      FROM (
        SELECT
          json_set(
            value,
            '$.prefix', COALESCE(json_extract(value, '$.prefix'), ''),
            '$.suffix', COALESCE(json_extract(value, '$.suffix'), ''),
            '$.note', CASE
              WHEN json_type(value, '$.note') IS NOT NULL THEN json_extract(value, '$.note')
              WHEN trim(COALESCE(json_extract(value, '$.label'), '')) <> ''
                THEN json_extract(value, '$.label')
              ELSE NULL
            END
          ) AS item
        FROM json_each(projection_threads.thread_markers_json)
        ORDER BY CAST(key AS INTEGER)
      )
    )
    WHERE json_valid(thread_markers_json)
      AND json_type(thread_markers_json) = 'array'
  `;

  yield* sql`
    INSERT INTO projection_thread_highlights (
      marker_id,
      thread_id,
      message_id,
      start_offset,
      end_offset,
      selected_text,
      prefix,
      suffix,
      style,
      color,
      note,
      legacy_label,
      legacy_done,
      created_at,
      updated_at
    )
    SELECT
      json_extract(marker.value, '$.id'),
      thread.thread_id,
      json_extract(marker.value, '$.messageId'),
      json_extract(marker.value, '$.startOffset'),
      json_extract(marker.value, '$.endOffset'),
      json_extract(marker.value, '$.selectedText'),
      COALESCE(json_extract(marker.value, '$.prefix'), ''),
      COALESCE(json_extract(marker.value, '$.suffix'), ''),
      json_extract(marker.value, '$.style'),
      json_extract(marker.value, '$.color'),
      json_extract(marker.value, '$.note'),
      json_extract(marker.value, '$.label'),
      COALESCE(json_extract(marker.value, '$.done'), 0),
      json_extract(marker.value, '$.createdAt'),
      json_extract(marker.value, '$.updatedAt')
    FROM projection_threads AS thread
    JOIN json_each(thread.thread_markers_json) AS marker
    WHERE json_valid(thread.thread_markers_json)
      AND json_type(thread.thread_markers_json) = 'array'
      AND json_extract(marker.value, '$.id') IS NOT NULL
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
});
