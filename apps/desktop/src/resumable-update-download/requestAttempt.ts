import { createWriteStream, type WriteStream } from "node:fs";

import type {
  ElectronClientRequestLike,
  ElectronResponseLike,
  IdleTimeoutRequestLike,
  ResumableDownloadCallOptions,
  ResumableDownloadConfig,
  UpdaterHttpExecutorLike,
} from "./contracts";
import {
  buildDownloadHeaders,
  buildRequestOptions,
  classifyDownloadResponse,
  headerString,
  isCrossOrigin,
  parseIntOrNull,
} from "./responsePolicy";

export interface AttemptResult {
  readonly kind: "complete" | "interrupted";
  readonly reason: string;
  readonly totalSize: number | null;
}

interface SingleAttemptArgs {
  readonly url: URL;
  readonly destination: string;
  readonly options: ResumableDownloadCallOptions;
  readonly createRequest: UpdaterHttpExecutorLike["createRequest"];
  readonly config: ResumableDownloadConfig;
  readonly startOffset: number;
  readonly knownTotal: number | null;
  readonly setActiveRequest: (request: ElectronClientRequestLike | null) => void;
  readonly onChunk: (transferred: number, total: number | null, delta: number) => void;
}

export function runSingleAttempt(args: SingleAttemptArgs): Promise<AttemptResult> {
  const { url, destination, options, createRequest, config, startOffset, knownTotal } = args;
  return new Promise<AttemptResult>((resolve, reject) => {
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let writeStream: WriteStream | null = null;
    let activeResponse: ElectronResponseLike | null = null;
    let currentRequest: ElectronClientRequestLike | null = null;
    let discoveredTotal: number | null = knownTotal;
    let baseOffset = startOffset;
    let attemptBytes = 0;
    let redirectCount = 0;

    const clearIdle = (): void => {
      if (idleTimer != null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const detachResponse = (): void => {
      if (activeResponse != null) {
        try {
          activeResponse.pause();
          activeResponse.removeAllListeners();
        } catch {
          // ignore
        }
        activeResponse = null;
      }
    };

    const abortCurrent = (): void => {
      try {
        currentRequest?.abort();
      } catch {
        // ignore
      }
    };

    const finish = (result: AttemptResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearIdle();
      detachResponse();
      args.setActiveRequest(null);
      if (writeStream != null) {
        writeStream.end(() => resolve(result));
      } else {
        resolve(result);
      }
    };

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearIdle();
      detachResponse();
      args.setActiveRequest(null);
      if (writeStream != null) {
        writeStream.destroy();
      }
      reject(error);
    };

    const armIdle = (): void => {
      clearIdle();
      idleTimer = setTimeout(() => {
        abortCurrent();
        finish({ kind: "interrupted", reason: "idle-timeout", totalSize: discoveredTotal });
      }, config.idleTimeoutMs);
      idleTimer.unref?.();
    };

    const onResponse = (res: ElectronResponseLike): void => {
      const statusCode = res.statusCode ?? 0;
      const action = classifyDownloadResponse({
        statusCode,
        contentRange: headerString(res.headers["content-range"]),
        contentLength: parseIntOrNull(headerString(res.headers["content-length"])),
        bytesAlreadyDownloaded: startOffset,
      });

      if (action.kind === "fatal") {
        res.on("error", () => {});
        res.pause();
        fail(new Error(`Cannot download update: HTTP ${statusCode}.`));
        abortCurrent();
        return;
      }
      if (action.kind === "retryable") {
        res.on("error", () => {});
        res.pause();
        finish({ kind: "interrupted", reason: `http-${statusCode}`, totalSize: discoveredTotal });
        abortCurrent();
        return;
      }
      if (action.kind === "complete") {
        res.on("error", () => {});
        res.pause();
        finish({ kind: "complete", reason: "range-complete", totalSize: discoveredTotal });
        abortCurrent();
        return;
      }

      if (action.total != null) {
        discoveredTotal = action.total;
      }
      baseOffset = action.kind === "append" ? startOffset : 0;
      const flags = action.kind === "append" ? "a" : "w";
      writeStream = createWriteStream(destination, { flags });
      writeStream.on("error", (error) =>
        fail(new Error(`Cannot write update file: ${error.message}`)),
      );

      activeResponse = res;
      res.on("error", () =>
        finish({ kind: "interrupted", reason: "response-error", totalSize: discoveredTotal }),
      );
      res.on("aborted", () =>
        finish({ kind: "interrupted", reason: "response-aborted", totalSize: discoveredTotal }),
      );
      res.on("data", (chunk: Buffer) => {
        armIdle();
        attemptBytes += chunk.length;
        const transferred = baseOffset + attemptBytes;
        args.onChunk(transferred, discoveredTotal, chunk.length);
        const canContinue = writeStream!.write(chunk);
        if (!canContinue) {
          res.pause();
          writeStream!.once("drain", () => res.resume());
        }
      });
      res.on("end", () => {
        const transferred = baseOffset + attemptBytes;
        const reachedTotal = discoveredTotal != null && transferred >= discoveredTotal;
        finish({
          kind: reachedTotal ? "complete" : "interrupted",
          reason: reachedTotal ? "end" : "premature-end",
          totalSize: discoveredTotal,
        });
      });
    };

    const connect = (targetUrl: URL): void => {
      const headers = buildDownloadHeaders({
        callHeaders: options.headers,
        startOffset,
        attachAuth: !isCrossOrigin(url, targetUrl),
      });
      let superseded = false;
      const request = createRequest(buildRequestOptions(targetUrl, headers), onResponse);
      currentRequest = request;
      args.setActiveRequest(request);
      request.on("redirect", (statusCode, _method, redirectUrl) => {
        if (superseded || settled) {
          return;
        }
        if (redirectCount >= config.maxRedirects) {
          fail(
            new Error(`Too many redirects while downloading update (> ${config.maxRedirects}).`),
          );
          return;
        }
        redirectCount += 1;
        armIdle();
        let nextUrl: URL;
        try {
          nextUrl = new URL(redirectUrl, targetUrl);
        } catch {
          fail(new Error(`Invalid redirect URL while downloading update: ${redirectUrl}`));
          return;
        }
        superseded = true;
        try {
          request.abort();
        } catch {
          // ignore
        }
        connect(nextUrl);
      });
      request.on("error", (error) => {
        if (superseded) {
          return;
        }
        finish({
          kind: "interrupted",
          reason: `request-error: ${error.message}`,
          totalSize: discoveredTotal,
        });
      });
      request.on("abort", () => {
        if (superseded) {
          return;
        }
        finish({ kind: "interrupted", reason: "request-abort", totalSize: discoveredTotal });
      });
      request.end();
    };

    armIdle();
    connect(url);
  });
}

export function installIdleTimeout(
  request: IdleTimeoutRequestLike,
  onTimeout: (error: Error) => void,
  timeoutMs: number,
): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = (): void => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const arm = (): void => {
    clear();
    timer = setTimeout(() => {
      timer = null;
      try {
        request.abort();
      } catch {
        // ignore
      }
      onTimeout(new Error(`Request timed out after ${timeoutMs}ms of inactivity.`));
    }, timeoutMs);
    timer.unref?.();
  };
  request.on("response", (response) => {
    arm();
    response.on("data", arm);
    response.on("end", clear);
    response.on("error", clear);
    response.on("aborted", clear);
  });
  request.on("error", clear);
  request.on("abort", clear);
  request.on("close", clear);
  arm();
}
