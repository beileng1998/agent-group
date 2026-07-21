import { Schema } from "effect";

import { IsoDateTime, MessageId, PositiveInt, ProjectId, ThreadId } from "./baseSchemas";
import {
  OrchestrationMessageRole,
  PinnedMessage,
  ThreadMarker,
  ThreadMarkerColor,
} from "./orchestration";

export const HIGHLIGHTS_LIST_DEFAULT_LIMIT = 50;
export const HIGHLIGHTS_LIST_MAX_LIMIT = 100;
export const HIGHLIGHTS_SEARCH_MAX_CHARS = 500;
export const HIGHLIGHT_PIN_MESSAGE_TEXT_MAX_CHARS = 20_000;

export const HighlightItemKind = Schema.Literals(["highlight", "pin"]);
export type HighlightItemKind = typeof HighlightItemKind.Type;

export const HighlightsScope = Schema.Union([
  Schema.Struct({ type: Schema.Literal("session"), sessionId: ThreadId }),
  Schema.Struct({ type: Schema.Literal("subtree"), sessionId: ThreadId }),
  Schema.Struct({ type: Schema.Literal("group"), groupId: ProjectId }),
  Schema.Struct({ type: Schema.Literal("global") }),
]);
export type HighlightsScope = typeof HighlightsScope.Type;

export const HighlightsNoteFilter = Schema.Literals(["all", "with-note", "without-note"]);
export type HighlightsNoteFilter = typeof HighlightsNoteFilter.Type;

export const HighlightsListInput = Schema.Struct({
  scope: HighlightsScope,
  query: Schema.optional(Schema.String.check(Schema.isMaxLength(HIGHLIGHTS_SEARCH_MAX_CHARS))).pipe(
    Schema.withDecodingDefault(() => ""),
  ),
  colors: Schema.optional(Schema.Array(ThreadMarkerColor).check(Schema.isMaxLength(4))).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  kinds: Schema.optional(Schema.Array(HighlightItemKind).check(Schema.isMaxLength(2))).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  noteFilter: Schema.optional(HighlightsNoteFilter).pipe(Schema.withDecodingDefault(() => "all")),
  cursor: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(1_024)))).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  limit: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(HIGHLIGHTS_LIST_MAX_LIMIT)),
  ).pipe(Schema.withDecodingDefault(() => HIGHLIGHTS_LIST_DEFAULT_LIMIT)),
});
export type HighlightsListInput = typeof HighlightsListInput.Type;

const HighlightGroup = Schema.Struct({
  id: ProjectId,
  title: Schema.String,
});

const HighlightSession = Schema.Struct({
  id: ThreadId,
  title: Schema.String,
  parentSessionId: Schema.NullOr(ThreadId),
  archivedAt: Schema.NullOr(IsoDateTime),
});

const HighlightMessage = Schema.Struct({
  id: MessageId,
  role: Schema.NullOr(OrchestrationMessageRole),
  createdAt: Schema.NullOr(IsoDateTime),
  exists: Schema.Boolean,
});

export const TextHighlightListItem = Schema.Struct({
  kind: Schema.Literal("highlight"),
  marker: ThreadMarker,
  group: HighlightGroup,
  session: HighlightSession,
  message: HighlightMessage,
});

export const PinnedHighlightListItem = Schema.Struct({
  kind: Schema.Literal("pin"),
  pin: PinnedMessage,
  group: HighlightGroup,
  session: HighlightSession,
  message: Schema.Struct({
    ...HighlightMessage.fields,
    text: Schema.String.check(Schema.isMaxLength(HIGHLIGHT_PIN_MESSAGE_TEXT_MAX_CHARS)),
  }),
});

export const HighlightListItem = Schema.Union([TextHighlightListItem, PinnedHighlightListItem]);
export type HighlightListItem = typeof HighlightListItem.Type;
export type TextHighlightListItem = typeof TextHighlightListItem.Type;
export type PinnedHighlightListItem = typeof PinnedHighlightListItem.Type;

export const HighlightsListOutput = Schema.Struct({
  items: Schema.Array(HighlightListItem),
  nextCursor: Schema.NullOr(Schema.String),
});
export type HighlightsListOutput = typeof HighlightsListOutput.Type;
