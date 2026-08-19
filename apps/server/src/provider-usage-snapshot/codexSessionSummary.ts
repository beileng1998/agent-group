import fs from "node:fs/promises";

import { normalizeCodexUsageLimits, readCodexTotalTokens } from "./codexUsageValues";
import { asRecord, type CodexSessionSummary, parseTimestampMs } from "./usageSnapshotValues";

const READ_CHUNK_BYTES = 64 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;

async function readFileRange(
  handle: Awaited<ReturnType<typeof fs.open>>,
  position: number,
  length: number,
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length);
  let bytesRead = 0;

  while (bytesRead < length) {
    const result = await handle.read(buffer, bytesRead, length - bytesRead, position + bytesRead);
    if (result.bytesRead === 0) break;
    bytesRead += result.bytesRead;
  }

  return buffer.subarray(0, bytesRead);
}

function parseSummaryLine(line: string): CodexSessionSummary | null {
  if (!line.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  const record = asRecord(parsed);
  if (!record || record.type !== "event_msg") return null;

  const payload = asRecord(record.payload);
  if (!payload || payload.type !== "token_count") return null;

  const timestampMs = parseTimestampMs(record.timestamp ?? payload.timestamp);
  if (timestampMs === null) return null;

  return {
    timestampMs,
    totalTokens: readCodexTotalTokens(payload),
    limits: normalizeCodexUsageLimits(payload.rate_limits ?? payload.rateLimits),
  };
}

/** Reads only the newest usable token-count record from a Codex JSONL archive. */
export async function readCodexSessionSummary(path: string): Promise<CodexSessionSummary | null> {
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(path, "r");
  } catch {
    return null;
  }

  try {
    const { size } = await handle.stat();
    let position = size;
    let partialLine = Buffer.alloc(0);
    let skippingOversizedLine = false;

    while (position > 0) {
      const length = Math.min(READ_CHUNK_BYTES, position);
      position -= length;
      const bytes = await readFileRange(handle, position, length);
      let lineEnd = bytes.length;

      for (let index = bytes.length - 1; index >= 0; index -= 1) {
        if (bytes[index] !== 0x0a) continue;

        const linePrefix = bytes.subarray(index + 1, lineEnd);
        if (skippingOversizedLine) {
          skippingOversizedLine = false;
        } else {
          const lineLength = linePrefix.length + partialLine.length;
          if (lineLength <= MAX_LINE_BYTES) {
            const summary = parseSummaryLine(
              Buffer.concat([linePrefix, partialLine], lineLength).toString("utf8"),
            );
            if (summary) return summary;
          }
        }

        partialLine = Buffer.alloc(0);
        lineEnd = index;
      }

      if (skippingOversizedLine) continue;

      const linePrefix = bytes.subarray(0, lineEnd);
      const lineLength = linePrefix.length + partialLine.length;
      if (lineLength > MAX_LINE_BYTES) {
        partialLine = Buffer.alloc(0);
        skippingOversizedLine = true;
        continue;
      }
      partialLine = Buffer.concat([linePrefix, partialLine], lineLength);
    }

    return skippingOversizedLine ? null : parseSummaryLine(partialLine.toString("utf8"));
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}
