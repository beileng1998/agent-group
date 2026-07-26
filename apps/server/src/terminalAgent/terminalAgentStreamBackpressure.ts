import { TERMINAL_AGENT_SNAPSHOT_MAX_BYTES, type TerminalAgentEvent } from "@agent-group/contracts";
import { Effect, Stream } from "effect";

import { TerminalAgentServiceError } from "./Services/TerminalAgentService";

const TERMINAL_STREAM_BUFFER_EVENTS = 256;
const TERMINAL_STREAM_EVENT_OVERHEAD_BYTES = 64 * 1024;
export const TERMINAL_STREAM_BUFFER_MAX_BYTES =
  TERMINAL_AGENT_SNAPSHOT_MAX_BYTES + TERMINAL_STREAM_EVENT_OVERHEAD_BYTES;

function terminalAgentEventBytes(event: TerminalAgentEvent): number {
  if (event.type === "output") {
    return Buffer.byteLength(event.data) + 256;
  }
  if (event.type === "attached") {
    return (
      Buffer.byteLength(event.snapshot.snapshotAnsi) +
      Buffer.byteLength(event.snapshot.scrollbackAnsi) +
      Buffer.byteLength(event.snapshot.rehydrateSequences) +
      Buffer.byteLength(event.snapshot.pendingEscapeTailAnsi ?? "") +
      512
    );
  }
  return Buffer.byteLength(JSON.stringify(event));
}

const backpressureError = () =>
  new TerminalAgentServiceError({
    reason: "stale-runtime",
    message: "Terminal output consumer fell behind; reconnect for a fresh snapshot.",
  });

/**
 * Bounds the final websocket-facing backlog by bytes as well as event count.
 * Suspending preserves ordering; exceeding the byte budget fails the stream so
 * the client reconnects to a fresh xterm snapshot.
 */
export function bufferTerminalAgentStream<E, R>(
  stream: Stream.Stream<TerminalAgentEvent, E, R>,
): Stream.Stream<TerminalAgentEvent, E | TerminalAgentServiceError, R> {
  return Stream.unwrap(
    Effect.sync(() => {
      const queuedSizes: number[] = [];
      let pendingBytes = 0;
      return stream.pipe(
        Stream.tap((event) => {
          const bytes = terminalAgentEventBytes(event);
          if (pendingBytes + bytes > TERMINAL_STREAM_BUFFER_MAX_BYTES) {
            return Effect.fail(backpressureError());
          }
          pendingBytes += bytes;
          queuedSizes.push(bytes);
          return Effect.void;
        }),
        Stream.buffer({
          capacity: TERMINAL_STREAM_BUFFER_EVENTS,
          strategy: "suspend",
        }),
        Stream.tap(() =>
          Effect.sync(() => {
            pendingBytes -= queuedSizes.shift() ?? 0;
          }),
        ),
      );
    }),
  );
}
