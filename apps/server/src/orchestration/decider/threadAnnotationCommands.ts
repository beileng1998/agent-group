import type { OrchestrationCommand, OrchestrationReadModel, ThreadMarker } from "@agent-group/contracts";
import {
  PINNED_MESSAGES_MAX_COUNT,
  THREAD_MARKER_CONTEXT_MAX_CHARS,
  THREAD_MARKERS_MAX_COUNT,
} from "@agent-group/contracts";
import {
  doThreadMarkerRangesOverlap,
  normalizeThreadMarkerNote,
} from "@agent-group/shared/threadMarkers";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "../Errors.ts";
import { requireThread } from "../commandInvariants.ts";
import { type DeciderResult, nowIso, withEventBase } from "./common.ts";

type ThreadAnnotationCommand = Extract<
  OrchestrationCommand,
  {
    type:
      | "thread.pinned-message.add"
      | "thread.pinned-message.remove"
      | "thread.pinned-message.done.set"
      | "thread.pinned-message.label.set"
      | "thread.marker.add"
      | "thread.marker.remove"
      | "thread.marker.done.set"
      | "thread.marker.label.set"
      | "thread.marker.color.set"
      | "thread.marker.note.set";
  }
>;

export const decideThreadAnnotationCommand = Effect.fn("decideThreadAnnotationCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: ThreadAnnotationCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<DeciderResult, OrchestrationCommandInvariantError> {
  switch (command.type) {
    case "thread.pinned-message.add": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const existingPin = thread.pinnedMessages?.find((pin) => pin.messageId === command.messageId);
      if (!existingPin && (thread.pinnedMessages?.length ?? 0) >= PINNED_MESSAGES_MAX_COUNT) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Thread '${command.threadId}' already has the maximum of ${PINNED_MESSAGES_MAX_COUNT} pinned messages.`,
        });
      }
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.pinned-message-added",
        payload: {
          threadId: command.threadId,
          pin: existingPin ?? {
            messageId: command.messageId,
            label: null,
            done: false,
            pinnedAt: occurredAt,
          },
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.pinned-message.remove": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.pinned-message-removed",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.pinned-message.done.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.pinned-message-done-set",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          done: command.done,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.pinned-message.label.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.pinned-message-label-set",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          label: command.label,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.marker.add": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      if (command.endOffset <= command.startOffset) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Marker end offset must be greater than start offset.`,
        });
      }
      const sourceMessage = thread.messages.find((message) => message.id === command.messageId);
      if (!sourceMessage) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `The highlighted source message is unavailable.`,
        });
      }
      if (
        command.endOffset > sourceMessage.text.length ||
        sourceMessage.text.slice(command.startOffset, command.endOffset) !== command.selectedText
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `The highlighted text no longer matches its source message.`,
        });
      }
      let existingMarker: ThreadMarker | undefined = undefined;
      for (const marker of thread.threadMarkers ?? []) {
        if (
          marker.id === command.markerId ||
          (marker.messageId === command.messageId &&
            marker.startOffset === command.startOffset &&
            marker.endOffset === command.endOffset &&
            marker.style === command.style)
        ) {
          existingMarker = marker;
        }
        if (
          doThreadMarkerRangesOverlap(marker, {
            messageId: command.messageId,
            startOffset: command.startOffset,
            endOffset: command.endOffset,
          })
        ) {
          if (!existingMarker || marker.id !== existingMarker.id) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `Highlights cannot overlap. Edit or remove the existing highlight first.`,
            });
          }
        }
      }
      if (!existingMarker && (thread.threadMarkers?.length ?? 0) >= THREAD_MARKERS_MAX_COUNT) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Thread '${command.threadId}' already has the maximum of ${THREAD_MARKERS_MAX_COUNT} markers.`,
        });
      }
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.marker-added",
        payload: {
          threadId: command.threadId,
          marker: existingMarker ?? {
            id: command.markerId,
            messageId: command.messageId,
            startOffset: command.startOffset,
            endOffset: command.endOffset,
            selectedText: command.selectedText,
            prefix: sourceMessage.text.slice(
              Math.max(0, command.startOffset - THREAD_MARKER_CONTEXT_MAX_CHARS),
              command.startOffset,
            ),
            suffix: sourceMessage.text.slice(
              command.endOffset,
              command.endOffset + THREAD_MARKER_CONTEXT_MAX_CHARS,
            ),
            style: command.style,
            color: command.color,
            note: null,
            label: null,
            done: false,
            createdAt: occurredAt,
            updatedAt: occurredAt,
          },
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.marker.remove": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.marker-removed",
        payload: {
          threadId: command.threadId,
          markerId: command.markerId,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.marker.done.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.marker-done-set",
        payload: {
          threadId: command.threadId,
          markerId: command.markerId,
          done: command.done,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.marker.label.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.marker-label-set",
        payload: {
          threadId: command.threadId,
          markerId: command.markerId,
          label: command.label,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.marker.color.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.marker-color-set",
        payload: {
          threadId: command.threadId,
          markerId: command.markerId,
          color: command.color,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.marker.note.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.marker-note-set",
        payload: {
          threadId: command.threadId,
          markerId: command.markerId,
          note: normalizeThreadMarkerNote(command.note),
          updatedAt: occurredAt,
        },
      };
    }

    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown command type: ${fallback.type}`,
      });
    }
  }
});
