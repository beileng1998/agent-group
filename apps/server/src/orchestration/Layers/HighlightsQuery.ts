import { Buffer } from "node:buffer";

import {
  HIGHLIGHT_PIN_MESSAGE_TEXT_MAX_CHARS,
  HIGHLIGHTS_LIST_DEFAULT_LIMIT,
  HighlightListItem,
  HighlightsListOutput,
  type HighlightsListInput,
  type ThreadMarkerColor,
} from "@agent-group/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../../persistence/Errors.ts";
import { HighlightsQuery, type HighlightsQueryShape } from "../Services/HighlightsQuery.ts";

interface HighlightCursor {
  readonly updatedAt: string;
  readonly itemId: string;
}

interface HighlightDbRow {
  readonly markerId: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly selectedText: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly style: "highlight" | "underline";
  readonly color: ThreadMarkerColor;
  readonly note: string | null;
  readonly legacyLabel: string | null;
  readonly legacyDone: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly threadTitle: string;
  readonly parentThreadId: string | null;
  readonly archivedAt: string | null;
  readonly messageRole: "user" | "assistant" | "system" | null;
  readonly messageCreatedAt: string | null;
  readonly messageExists: number;
}

interface PinnedMessageDbRow {
  readonly threadId: string;
  readonly messageId: string;
  readonly label: string | null;
  readonly done: number;
  readonly pinnedAt: string;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly threadTitle: string;
  readonly parentThreadId: string | null;
  readonly archivedAt: string | null;
  readonly messageRole: "user" | "assistant" | "system" | null;
  readonly messageCreatedAt: string | null;
  readonly messageText: string;
  readonly messageExists: number;
}

interface OrderedHighlightItem {
  readonly itemId: string;
  readonly updatedAt: string;
  readonly value: unknown;
}

const decodeItem = Schema.decodeUnknownEffect(HighlightListItem);
const decodeOutput = Schema.decodeUnknownEffect(HighlightsListOutput);

function encodeCursor(cursor: HighlightCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | null): HighlightCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as HighlightCursor).updatedAt === "string" &&
      typeof (parsed as HighlightCursor).itemId === "string"
    ) {
      return parsed as HighlightCursor;
    }
  } catch {
    // Invalid cursors are rejected by the caller below.
  }
  throw new Error("Invalid highlights cursor");
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

const makeHighlightsQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const list: HighlightsQueryShape["list"] = (input) =>
    Effect.gen(function* () {
      const query = input.query ?? "";
      const colors = input.colors ?? [];
      const kinds = input.kinds ?? [];
      const noteFilter = input.noteFilter ?? "all";
      const limit = input.limit ?? HIGHLIGHTS_LIST_DEFAULT_LIMIT;
      const cursor = yield* Effect.try({
        try: () => decodeCursor(input.cursor ?? null),
        catch: (cause) => toPersistenceSqlError("HighlightsQuery.list:cursor")(cause),
      });
      const scopeType = input.scope.type;
      const sessionId =
        input.scope.type === "session" || input.scope.type === "subtree"
          ? input.scope.sessionId
          : "";
      const groupId = input.scope.type === "group" ? input.scope.groupId : "";
      const normalizedQuery = query.trim();
      const searchPattern = `%${escapeLike(normalizedQuery)}%`;
      const colorValues = colors.length > 0 ? colors : (["__none__"] as const);
      const includeHighlights = kinds.length === 0 || kinds.includes("highlight");
      const includePins = (kinds.length === 0 || kinds.includes("pin")) && colors.length === 0;
      const highlightRows = yield* sql<HighlightDbRow>`
        WITH RECURSIVE session_tree(thread_id, project_id) AS (
          SELECT thread_id, project_id
          FROM projection_threads
          WHERE thread_id = ${sessionId}
            AND deleted_at IS NULL
          UNION
          SELECT child.thread_id, child.project_id
          FROM projection_threads AS child
          JOIN session_tree AS parent
            ON child.parent_thread_id = parent.thread_id
           AND child.project_id = parent.project_id
          WHERE child.deleted_at IS NULL
            AND child.thread_id NOT LIKE 'subagent:%'
            AND child.subagent_agent_id IS NULL
            AND child.subagent_nickname IS NULL
            AND child.subagent_role IS NULL
            AND child.fork_source_thread_id IS NULL
            AND child.handoff_json IS NULL
            AND (
              child.sidechat_source_thread_id IS NULL
              OR child.parent_thread_id = child.sidechat_source_thread_id
            )
        )
        SELECT
          h.marker_id AS "markerId",
          h.thread_id AS "threadId",
          h.message_id AS "messageId",
          h.start_offset AS "startOffset",
          h.end_offset AS "endOffset",
          h.selected_text AS "selectedText",
          h.prefix,
          h.suffix,
          h.style,
          h.color,
          h.note,
          h.legacy_label AS "legacyLabel",
          h.legacy_done AS "legacyDone",
          h.created_at AS "createdAt",
          h.updated_at AS "updatedAt",
          p.project_id AS "projectId",
          p.title AS "projectTitle",
          t.title AS "threadTitle",
          t.parent_thread_id AS "parentThreadId",
          t.archived_at AS "archivedAt",
          m.role AS "messageRole",
          m.created_at AS "messageCreatedAt",
          CASE
            WHEN m.message_id IS NULL THEN 0
            WHEN substr(m.text, h.start_offset + 1, h.end_offset - h.start_offset) = h.selected_text
              THEN 1
            WHEN instr(m.text, h.selected_text) > 0 THEN 1
            ELSE 0
          END AS "messageExists"
        FROM projection_thread_highlights AS h
        JOIN projection_threads AS t ON t.thread_id = h.thread_id
        JOIN projection_projects AS p ON p.project_id = t.project_id
        LEFT JOIN projection_thread_messages AS m
          ON m.message_id = h.message_id AND m.thread_id = h.thread_id
        WHERE t.deleted_at IS NULL
          AND p.deleted_at IS NULL
          AND p.kind = 'project'
          AND ${includeHighlights ? 1 : 0} = 1
          AND (
            ${scopeType} = 'global'
            OR (${scopeType} = 'session' AND t.thread_id = ${sessionId})
            OR (${scopeType} = 'group' AND t.project_id = ${groupId})
            OR (
              ${scopeType} = 'subtree'
              AND EXISTS (SELECT 1 FROM session_tree tree WHERE tree.thread_id = t.thread_id)
            )
          )
          AND (
            ${normalizedQuery.length === 0 ? 1 : 0}
            OR h.selected_text LIKE ${searchPattern} ESCAPE '\\'
            OR COALESCE(h.note, '') LIKE ${searchPattern} ESCAPE '\\'
          )
          AND (${colors.length === 0 ? 1 : 0} OR h.color IN ${sql.in(colorValues)})
          AND (
            ${noteFilter} = 'all'
            OR (${noteFilter} = 'with-note' AND trim(COALESCE(h.note, '')) <> '')
            OR (${noteFilter} = 'without-note' AND trim(COALESCE(h.note, '')) = '')
          )
          AND (
            ${cursor === null ? 1 : 0}
            OR h.updated_at < ${cursor?.updatedAt ?? ""}
            OR (
              h.updated_at = ${cursor?.updatedAt ?? ""}
              AND ('highlight:' || h.marker_id) < ${cursor?.itemId ?? ""}
            )
          )
        ORDER BY h.updated_at DESC, ('highlight:' || h.marker_id) DESC
        LIMIT ${limit + 1}
      `;

      const pinnedRows = yield* sql<PinnedMessageDbRow>`
        WITH RECURSIVE session_tree(thread_id, project_id) AS (
          SELECT thread_id, project_id
          FROM projection_threads
          WHERE thread_id = ${sessionId}
            AND deleted_at IS NULL
          UNION
          SELECT child.thread_id, child.project_id
          FROM projection_threads AS child
          JOIN session_tree AS parent
            ON child.parent_thread_id = parent.thread_id
           AND child.project_id = parent.project_id
          WHERE child.deleted_at IS NULL
            AND child.thread_id NOT LIKE 'subagent:%'
            AND child.subagent_agent_id IS NULL
            AND child.subagent_nickname IS NULL
            AND child.subagent_role IS NULL
            AND child.fork_source_thread_id IS NULL
            AND child.handoff_json IS NULL
            AND (
              child.sidechat_source_thread_id IS NULL
              OR child.parent_thread_id = child.sidechat_source_thread_id
            )
        )
        SELECT
          t.thread_id AS "threadId",
          json_extract(pin.value, '$.messageId') AS "messageId",
          json_extract(pin.value, '$.label') AS label,
          COALESCE(json_extract(pin.value, '$.done'), 0) AS done,
          json_extract(pin.value, '$.pinnedAt') AS "pinnedAt",
          p.project_id AS "projectId",
          p.title AS "projectTitle",
          t.title AS "threadTitle",
          t.parent_thread_id AS "parentThreadId",
          t.archived_at AS "archivedAt",
          m.role AS "messageRole",
          m.created_at AS "messageCreatedAt",
          substr(COALESCE(m.text, ''), 1, ${HIGHLIGHT_PIN_MESSAGE_TEXT_MAX_CHARS}) AS "messageText",
          CASE WHEN m.message_id IS NULL THEN 0 ELSE 1 END AS "messageExists"
        FROM projection_threads AS t
        JOIN projection_projects AS p ON p.project_id = t.project_id
        JOIN json_each(
          CASE
            WHEN json_valid(t.pinned_messages_json)
              AND json_type(t.pinned_messages_json) = 'array'
              THEN t.pinned_messages_json
            ELSE '[]'
          END
        ) AS pin
        LEFT JOIN projection_thread_messages AS m
          ON m.message_id = json_extract(pin.value, '$.messageId')
         AND m.thread_id = t.thread_id
        WHERE t.deleted_at IS NULL
          AND p.deleted_at IS NULL
          AND p.kind = 'project'
          AND ${includePins ? 1 : 0} = 1
          AND json_extract(pin.value, '$.messageId') IS NOT NULL
          AND json_extract(pin.value, '$.pinnedAt') IS NOT NULL
          AND (
            ${scopeType} = 'global'
            OR (${scopeType} = 'session' AND t.thread_id = ${sessionId})
            OR (${scopeType} = 'group' AND t.project_id = ${groupId})
            OR (
              ${scopeType} = 'subtree'
              AND EXISTS (SELECT 1 FROM session_tree tree WHERE tree.thread_id = t.thread_id)
            )
          )
          AND (
            ${normalizedQuery.length === 0 ? 1 : 0}
            OR COALESCE(m.text, '') LIKE ${searchPattern} ESCAPE '\\'
            OR COALESCE(json_extract(pin.value, '$.label'), '') LIKE ${searchPattern} ESCAPE '\\'
          )
          AND (
            ${noteFilter} = 'all'
            OR (
              ${noteFilter} = 'with-note'
              AND trim(COALESCE(json_extract(pin.value, '$.label'), '')) <> ''
            )
            OR (
              ${noteFilter} = 'without-note'
              AND trim(COALESCE(json_extract(pin.value, '$.label'), '')) = ''
            )
          )
          AND (
            ${cursor === null ? 1 : 0}
            OR json_extract(pin.value, '$.pinnedAt') < ${cursor?.updatedAt ?? ""}
            OR (
              json_extract(pin.value, '$.pinnedAt') = ${cursor?.updatedAt ?? ""}
              AND ('pin:' || t.thread_id || ':' || json_extract(pin.value, '$.messageId'))
                < ${cursor?.itemId ?? ""}
            )
          )
        ORDER BY
          json_extract(pin.value, '$.pinnedAt') DESC,
          ('pin:' || t.thread_id || ':' || json_extract(pin.value, '$.messageId')) DESC
        LIMIT ${limit + 1}
      `;

      const orderedItems: OrderedHighlightItem[] = [
        ...highlightRows.map((row) => ({
          itemId: `highlight:${row.markerId}`,
          updatedAt: row.updatedAt,
          value: {
            kind: "highlight",
            marker: {
              id: row.markerId,
              messageId: row.messageId,
              startOffset: row.startOffset,
              endOffset: row.endOffset,
              selectedText: row.selectedText,
              prefix: row.prefix,
              suffix: row.suffix,
              style: row.style,
              color: row.color,
              note: row.note,
              label: row.legacyLabel,
              done: row.legacyDone !== 0,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            },
            group: { id: row.projectId, title: row.projectTitle },
            session: {
              id: row.threadId,
              title: row.threadTitle,
              parentSessionId: row.parentThreadId,
              archivedAt: row.archivedAt,
            },
            message: {
              id: row.messageId,
              role: row.messageRole,
              createdAt: row.messageCreatedAt,
              exists: row.messageExists !== 0,
            },
          },
        })),
        ...pinnedRows.map((row) => ({
          itemId: `pin:${row.threadId}:${row.messageId}`,
          updatedAt: row.pinnedAt,
          value: {
            kind: "pin",
            pin: {
              messageId: row.messageId,
              label: row.label,
              done: row.done !== 0,
              pinnedAt: row.pinnedAt,
            },
            group: { id: row.projectId, title: row.projectTitle },
            session: {
              id: row.threadId,
              title: row.threadTitle,
              parentSessionId: row.parentThreadId,
              archivedAt: row.archivedAt,
            },
            message: {
              id: row.messageId,
              role: row.messageRole,
              createdAt: row.messageCreatedAt,
              exists: row.messageExists !== 0,
              text: row.messageText,
            },
          },
        })),
      ].sort((left, right) => {
        const dateOrder = right.updatedAt.localeCompare(left.updatedAt);
        if (dateOrder !== 0) return dateOrder;
        return right.itemId.localeCompare(left.itemId);
      });
      const pageItems = orderedItems.slice(0, limit);
      const items = yield* Effect.forEach(pageItems, (item) =>
        decodeItem(item.value).pipe(
          Effect.mapError(toPersistenceDecodeError("HighlightsQuery.list:item")),
        ),
      );
      const last = pageItems.at(-1);
      const nextCursor =
        orderedItems.length > limit && last
          ? encodeCursor({ updatedAt: last.updatedAt, itemId: last.itemId })
          : null;
      return yield* decodeOutput({ items, nextCursor }).pipe(
        Effect.mapError(toPersistenceDecodeError("HighlightsQuery.list:output")),
      );
    }).pipe(
      Effect.catchTag("SqlError", (cause) =>
        Effect.fail(toPersistenceSqlError("HighlightsQuery.list:query")(cause)),
      ),
    );

  return { list } satisfies HighlightsQueryShape;
});

export const HighlightsQueryLive = Layer.effect(HighlightsQuery, makeHighlightsQuery);
