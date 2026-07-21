import * as Path from "node:path";
import { app } from "electron";
import { RotatingFileSink } from "@agent-group/shared/logging";

import { APP_RUN_ID, LOG_DIR, LOG_FILE_MAX_BYTES, LOG_FILE_MAX_FILES } from "./constants";
import { desktopState } from "./state";
import { isBrokenPipeError } from "../desktopProcessErrors";

function logTimestamp(): string {
  return new Date().toISOString();
}

function logScope(scope: string): string {
  return `${scope} run=${APP_RUN_ID}`;
}

function sanitizeLogValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function writeDesktopLogHeader(message: string): void {
  desktopState.desktopLogSink?.write(`[${logTimestamp()}] [${logScope("desktop")}] ${message}\n`);
}

export function writeBackendSessionBoundary(phase: "START" | "END", details: string): void {
  if (!desktopState.backendLogSink) return;
  desktopState.backendLogSink.write(
    `[${logTimestamp()}] ---- APP SESSION ${phase} run=${APP_RUN_ID} ${sanitizeLogValue(details)} ----\n`,
  );
}

function writeDesktopStreamChunk(
  streamName: "stdout" | "stderr",
  chunk: unknown,
  encoding: BufferEncoding | undefined,
): void {
  if (!desktopState.desktopLogSink) return;
  const buffer = Buffer.isBuffer(chunk)
    ? chunk
    : Buffer.from(String(chunk), typeof chunk === "string" ? encoding : undefined);
  desktopState.desktopLogSink.write(`[${logTimestamp()}] [${logScope(streamName)}] `);
  desktopState.desktopLogSink.write(buffer);
  if (buffer.length === 0 || buffer[buffer.length - 1] !== 0x0a) {
    desktopState.desktopLogSink.write("\n");
  }
}

function installStdIoCapture(): void {
  if (!app.isPackaged || !desktopState.desktopLogSink || desktopState.restoreStdIoCapture) return;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const patchWrite =
    (streamName: "stdout" | "stderr", originalWrite: typeof process.stdout.write) =>
    (
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ): boolean => {
      const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : undefined;
      writeDesktopStreamChunk(streamName, chunk, encoding);
      if (typeof encodingOrCallback === "function") return originalWrite(chunk, encodingOrCallback);
      if (callback !== undefined) return originalWrite(chunk, encoding, callback);
      if (encoding !== undefined) return originalWrite(chunk, encoding);
      return originalWrite(chunk);
    };
  process.stdout.write = patchWrite("stdout", originalStdoutWrite);
  process.stderr.write = patchWrite("stderr", originalStderrWrite);
  desktopState.restoreStdIoCapture = () => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    desktopState.restoreStdIoCapture = null;
  };
}

export function initializePackagedLogging(): void {
  if (!app.isPackaged) return;
  try {
    desktopState.desktopLogSink = new RotatingFileSink({
      filePath: Path.join(LOG_DIR, "desktop-main.log"),
      maxBytes: LOG_FILE_MAX_BYTES,
      maxFiles: LOG_FILE_MAX_FILES,
    });
    desktopState.backendLogSink = new RotatingFileSink({
      filePath: Path.join(LOG_DIR, "server-child.log"),
      maxBytes: LOG_FILE_MAX_BYTES,
      maxFiles: LOG_FILE_MAX_FILES,
    });
    installStdIoCapture();
    writeDesktopLogHeader(`runtime log capture enabled logDir=${LOG_DIR}`);
  } catch (error) {
    try {
      console.error("[desktop] failed to initialize packaged logging", error);
    } catch (consoleError: unknown) {
      if (!isBrokenPipeError(consoleError)) throw consoleError;
    }
  }
}
