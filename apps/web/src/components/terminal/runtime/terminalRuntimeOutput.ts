import type { TerminalSessionSnapshot } from "@agent-group/contracts";

import { readNativeApi } from "~/nativeApi";

import { observeTerminalWriteParsed } from "../terminalPerformance";
import type { TerminalRuntimeEntry } from "../terminalRuntimeTypes";
import { setTerminalRuntimeStatus } from "./terminalRuntimeContract";

const WRITE_BATCH_SIZE_LIMIT = 262_144;
const WRITE_BATCH_MAX_LATENCY_MS = 50;
const TERMINAL_TEXT_ENCODER = new TextEncoder();

export function terminalByteLength(data: string): number {
  return TERMINAL_TEXT_ENCODER.encode(data).byteLength;
}

function acknowledgeParsedOutput(entry: TerminalRuntimeEntry, bytes: number): void {
  if (bytes <= 0) return;
  const api = readNativeApi();
  if (!api) return;
  const ackOutput = api.terminal.ackOutput;
  if (typeof ackOutput !== "function") return;

  void ackOutput({
    threadId: entry.threadId,
    terminalId: entry.terminalId,
    bytes,
  }).catch(() => {
    // Flow control is best-effort; reconnect/replay will recover from a missed ACK.
  });
}

export function clearPendingTerminalWrites(entry: TerminalRuntimeEntry): void {
  if (entry.writeRafHandle !== null) {
    window.cancelAnimationFrame(entry.writeRafHandle);
    entry.writeRafHandle = null;
  }
  if (entry.writeFlushTimeout !== null) {
    window.clearTimeout(entry.writeFlushTimeout);
    entry.writeFlushTimeout = null;
  }
  if (entry.pendingWriteBytes > 0) {
    acknowledgeParsedOutput(entry, entry.pendingWriteBytes);
  }
  entry.pendingWrites.length = 0;
  entry.pendingWriteLength = 0;
  entry.pendingWriteBytes = 0;
}

export function flushPendingTerminalWrites(entry: TerminalRuntimeEntry): void {
  if (entry.writeRafHandle !== null) {
    window.cancelAnimationFrame(entry.writeRafHandle);
    entry.writeRafHandle = null;
  }
  if (entry.writeFlushTimeout !== null) {
    window.clearTimeout(entry.writeFlushTimeout);
    entry.writeFlushTimeout = null;
  }
  if (entry.pendingWrites.length === 0) {
    entry.pendingWriteLength = 0;
    entry.pendingWriteBytes = 0;
    return;
  }
  const combined = entry.pendingWrites.map((write) => write.data).join("");
  const byteLength = entry.pendingWriteBytes;
  const queuedAt = entry.pendingWrites[0]?.queuedAt ?? performance.now();
  entry.pendingWrites.length = 0;
  entry.pendingWriteLength = 0;
  entry.pendingWriteBytes = 0;
  entry.terminal.write(combined, () => {
    acknowledgeParsedOutput(entry, byteLength);
    observeTerminalWriteParsed({
      runtimeKey: entry.runtimeKey,
      bytes: byteLength,
      queuedAt,
    });
  });
}

export function scheduleTerminalWrite(
  entry: TerminalRuntimeEntry,
  data: string,
  byteLength: number,
): void {
  entry.pendingWrites.push({
    data,
    byteLength,
    queuedAt: performance.now(),
  });
  entry.pendingWriteLength += data.length;
  entry.pendingWriteBytes += byteLength;

  if (entry.pendingWriteBytes >= WRITE_BATCH_SIZE_LIMIT) {
    flushPendingTerminalWrites(entry);
    return;
  }

  if (entry.writeRafHandle === null) {
    entry.writeRafHandle = window.requestAnimationFrame(() => {
      entry.writeRafHandle = null;
      flushPendingTerminalWrites(entry);
    });
  }
  if (entry.writeFlushTimeout === null) {
    entry.writeFlushTimeout = window.setTimeout(() => {
      entry.writeFlushTimeout = null;
      flushPendingTerminalWrites(entry);
    }, WRITE_BATCH_MAX_LATENCY_MS);
  }
}

export function replayTerminalSnapshot(
  entry: TerminalRuntimeEntry,
  snapshot: TerminalSessionSnapshot,
  onParsed?: () => void,
): void {
  entry.titleInputBuffer = "";
  entry.linkMatchCache.clear();
  clearPendingTerminalWrites(entry);
  entry.terminal.write("\u001bc");

  const payload = `${snapshot.replayPreamble ?? ""}${snapshot.history}`;
  if (payload.length > 0) {
    setTerminalRuntimeStatus(entry, "replaying");
    entry.terminal.write(payload, onParsed);
    return;
  }
  onParsed?.();
}
