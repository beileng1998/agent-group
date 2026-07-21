import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";

import type {
  ElectronClientRequestLike,
  ResumableDownloadCallOptions,
  ResumableDownloadConfig,
  ResumableDownloadLogger,
  UpdaterHttpExecutorLike,
} from "./contracts";
import { runSingleAttempt } from "./requestAttempt";
import {
  computeProgressInfo,
  computeRetryDelayMs,
  selectSha512Encoding,
  shouldGiveUp,
} from "./responsePolicy";

async function safeFileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function removeFileIfExists(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot remove stale update temp file before clean download: ${message}`, {
      cause: error,
    });
  }
}

async function verifySha512(path: string, expected: string): Promise<void> {
  const encoding = selectSha512Encoding(expected);
  const actual = await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha512");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest(encoding)));
  });
  if (actual !== expected) {
    throw new Error(`sha512 checksum mismatch (expected ${expected}, got ${actual}).`);
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

interface RunResumableDownloadArgs {
  readonly url: URL;
  readonly destination: string;
  readonly options: ResumableDownloadCallOptions;
  readonly createRequest: UpdaterHttpExecutorLike["createRequest"];
  readonly config: ResumableDownloadConfig;
  readonly logger: ResumableDownloadLogger;
  readonly registerCancel: (handler: () => void) => void;
}

export async function runResumableDownload(args: RunResumableDownloadArgs): Promise<void> {
  const { url, destination, options, createRequest, config, logger, registerCancel } = args;

  let activeRequest: ElectronClientRequestLike | null = null;
  let cancelled = false;
  registerCancel(() => {
    cancelled = true;
    try {
      activeRequest?.abort();
    } catch {
      // ignore
    }
  });

  const startedAtMs = Date.now();
  await removeFileIfExists(destination);

  let totalSize: number | null = null;
  let verifyRetryUsed = false;

  for (;;) {
    if (cancelled || options.cancellationToken.cancelled) {
      return;
    }

    let downloaded = await safeFileSize(destination);
    let consecutiveStall = 0;
    let attempts = 0;

    let lastEmitMs = 0;
    let deltaAccum = 0;
    const emit = (transferred: number, total: number | null, force: boolean): void => {
      if (options.onProgress == null || total == null) {
        return;
      }
      const now = Date.now();
      if (!force && now - lastEmitMs < config.progressThrottleMs) {
        return;
      }
      options.onProgress(
        computeProgressInfo({
          transferred,
          total,
          delta: deltaAccum,
          elapsedMs: now - startedAtMs,
        }),
      );
      lastEmitMs = now;
      deltaAccum = 0;
    };

    for (;;) {
      if (cancelled || options.cancellationToken.cancelled) {
        return;
      }
      attempts += 1;
      const startOffset = downloaded;
      const outcome = await runSingleAttempt({
        url,
        destination,
        options,
        createRequest,
        config,
        startOffset,
        knownTotal: totalSize,
        setActiveRequest: (request) => {
          activeRequest = request;
        },
        onChunk: (transferred, total, delta) => {
          if (total != null) {
            totalSize = total;
          }
          deltaAccum += delta;
          emit(transferred, total ?? totalSize, false);
        },
      });

      downloaded = await safeFileSize(destination);
      if (outcome.totalSize != null) {
        totalSize = outcome.totalSize;
      }

      if (outcome.kind === "complete") {
        break;
      }

      consecutiveStall = downloaded > startOffset ? 0 : consecutiveStall + 1;
      const elapsedMs = Date.now() - startedAtMs;
      if (
        shouldGiveUp({
          consecutiveStallCount: consecutiveStall,
          totalAttempts: attempts,
          elapsedMs,
          config,
        })
      ) {
        throw new Error(
          `Update download stalled and could not resume (${outcome.reason}; ` +
            `${downloaded}/${totalSize ?? "?"} bytes after ${attempts} attempts).`,
        );
      }
      logger.warn?.(
        `[desktop-updater] Update download interrupted at ${downloaded}/${totalSize ?? "?"} bytes ` +
          `(${outcome.reason}); resuming (attempt ${attempts + 1}).`,
      );
      await delay(computeRetryDelayMs(consecutiveStall, config));
    }

    const verifyError = await verifyDownloadedFile({
      destination,
      downloaded,
      totalSize,
      sha512: options.sha512,
    });
    if (verifyError == null) {
      if (totalSize != null) {
        emit(totalSize, totalSize, true);
      }
      logger.info?.(
        `[desktop-updater] Update download completed (${downloaded} bytes, ${attempts} attempt(s)).`,
      );
      return;
    }

    if (verifyRetryUsed) {
      throw verifyError;
    }
    verifyRetryUsed = true;
    totalSize = null;
    logger.warn?.(
      `[desktop-updater] Update verification failed (${verifyError.message}); ` +
        `discarding and re-downloading from zero once.`,
    );
    await removeFileIfExists(destination);
  }
}

async function verifyDownloadedFile(args: {
  readonly destination: string;
  readonly downloaded: number;
  readonly totalSize: number | null;
  readonly sha512?: string | undefined;
}): Promise<Error | null> {
  if (args.totalSize != null && args.downloaded !== args.totalSize) {
    return new Error(
      `Update download size mismatch (${args.downloaded} != ${args.totalSize} bytes).`,
    );
  }
  if (args.sha512 != null && args.sha512.length > 0) {
    try {
      await verifySha512(args.destination, args.sha512);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }
  return null;
}
