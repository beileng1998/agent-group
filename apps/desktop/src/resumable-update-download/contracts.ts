export interface ResumableProgressInfo {
  readonly total: number;
  readonly delta: number;
  readonly transferred: number;
  readonly percent: number;
  readonly bytesPerSecond: number;
}

export interface ResumableDownloadConfig {
  readonly idleTimeoutMs: number;
  readonly retryBaseDelayMs: number;
  readonly retryMaxDelayMs: number;
  readonly maxConsecutiveStallRetries: number;
  readonly maxTotalAttempts: number;
  readonly overallTimeoutMs: number;
  readonly progressThrottleMs: number;
  readonly maxRedirects: number;
}

export const DEFAULT_RESUMABLE_DOWNLOAD_CONFIG: ResumableDownloadConfig = {
  idleTimeoutMs: 15_000,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 5_000,
  maxConsecutiveStallRetries: 6,
  maxTotalAttempts: 100,
  overallTimeoutMs: 10 * 60_000,
  progressThrottleMs: 500,
  maxRedirects: 10,
};

export interface ResumableDownloadLogger {
  info?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
}

export interface CancellationTokenLike {
  readonly cancelled: boolean;
  createPromise<T>(
    callback: (
      resolve: (value: T) => void,
      reject: (error: Error) => void,
      onCancel: (handler: () => void) => void,
    ) => void,
  ): Promise<T>;
}

export interface ResumableDownloadCallOptions {
  readonly headers?: Record<string, string> | null;
  readonly cancellationToken: CancellationTokenLike;
  readonly sha512?: string;
  readonly sha2?: string;
  onProgress?: (info: ResumableProgressInfo) => void;
}

export interface ElectronResponseLike {
  readonly statusCode?: number;
  readonly headers: Record<string, string | string[] | undefined>;
  on(event: "data", listener: (chunk: Buffer) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "aborted", listener: () => void): void;
  removeAllListeners(): void;
  pause(): void;
  resume(): void;
}

export interface ElectronClientRequestLike {
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "abort", listener: () => void): void;
  on(event: "close", listener: () => void): void;
  on(
    event: "redirect",
    listener: (statusCode: number, method: string, redirectUrl: string) => void,
  ): void;
  end(): void;
  abort(): void;
}

export interface IdleTimeoutResponseLike {
  on(event: "data", listener: () => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: () => void): void;
  on(event: "aborted", listener: () => void): void;
}

export interface IdleTimeoutRequestLike {
  on(event: "response", listener: (response: IdleTimeoutResponseLike) => void): void;
  on(event: "error", listener: () => void): void;
  on(event: "abort", listener: () => void): void;
  on(event: "close", listener: () => void): void;
  abort(): void;
}

export interface UpdaterHttpExecutorLike {
  download(url: URL, destination: string, options: ResumableDownloadCallOptions): Promise<string>;
  createRequest(
    options: Record<string, unknown>,
    callback: (response: ElectronResponseLike) => void,
  ): ElectronClientRequestLike;
  addTimeOutHandler?(
    request: IdleTimeoutRequestLike,
    callback: (error: Error) => void,
    timeout: number,
  ): void;
}

export interface ResumableDownloaderTarget {
  httpExecutor: UpdaterHttpExecutorLike | null;
}
