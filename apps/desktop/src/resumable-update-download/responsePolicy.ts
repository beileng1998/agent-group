import type { ResumableDownloadConfig, ResumableProgressInfo } from "./contracts";

export function computeProgressInfo(args: {
  readonly transferred: number;
  readonly total: number;
  readonly delta: number;
  readonly elapsedMs: number;
}): ResumableProgressInfo {
  const elapsedSeconds = args.elapsedMs > 0 ? args.elapsedMs / 1000 : 0.001;
  return {
    total: args.total,
    delta: args.delta,
    transferred: args.transferred,
    percent: args.total > 0 ? (args.transferred / args.total) * 100 : 0,
    bytesPerSecond: Math.round(args.transferred / elapsedSeconds),
  };
}

export function parseContentRangeTotal(headerValue: string | null | undefined): number | null {
  if (!headerValue) {
    return null;
  }
  const match = headerValue.match(/\/\s*(\d+)\s*$/);
  if (!match) {
    return null;
  }
  const total = Number(match[1]);
  return Number.isFinite(total) && total > 0 ? total : null;
}

export function selectSha512Encoding(sha512: string): "hex" | "base64" {
  return sha512.length === 128 &&
    !sha512.includes("+") &&
    !sha512.includes("Z") &&
    !sha512.includes("=")
    ? "hex"
    : "base64";
}

export type DownloadResponseAction =
  | { readonly kind: "append"; readonly total: number | null }
  | { readonly kind: "fromStart"; readonly total: number | null }
  | { readonly kind: "complete" }
  | { readonly kind: "retryable"; readonly statusCode: number }
  | { readonly kind: "fatal"; readonly statusCode: number };

export function classifyDownloadResponse(args: {
  readonly statusCode: number;
  readonly contentRange: string | null;
  readonly contentLength: number | null;
  readonly bytesAlreadyDownloaded: number;
}): DownloadResponseAction {
  const { statusCode, contentRange, contentLength, bytesAlreadyDownloaded } = args;
  if (statusCode === 206) {
    const total =
      parseContentRangeTotal(contentRange) ??
      (contentLength != null ? bytesAlreadyDownloaded + contentLength : null);
    return { kind: "append", total };
  }
  if (statusCode === 200) {
    return { kind: "fromStart", total: contentLength };
  }
  if (statusCode === 416) {
    return { kind: "complete" };
  }
  if (statusCode === 429 || (statusCode >= 500 && statusCode <= 599)) {
    return { kind: "retryable", statusCode };
  }
  return { kind: "fatal", statusCode };
}

export function computeRetryDelayMs(
  consecutiveStallCount: number,
  config: Pick<ResumableDownloadConfig, "retryBaseDelayMs" | "retryMaxDelayMs">,
): number {
  if (consecutiveStallCount <= 1) {
    return 0;
  }
  const delay = config.retryBaseDelayMs * 2 ** (consecutiveStallCount - 2);
  return Math.min(delay, config.retryMaxDelayMs);
}

export function shouldGiveUp(args: {
  readonly consecutiveStallCount: number;
  readonly totalAttempts: number;
  readonly elapsedMs: number;
  readonly config: ResumableDownloadConfig;
}): boolean {
  return (
    args.consecutiveStallCount > args.config.maxConsecutiveStallRetries ||
    args.totalAttempts > args.config.maxTotalAttempts ||
    args.elapsedMs > args.config.overallTimeoutMs
  );
}

function effectivePort(url: URL): string {
  if (url.port.length > 0) {
    return url.port;
  }
  if (url.protocol === "https:") {
    return "443";
  }
  if (url.protocol === "http:") {
    return "80";
  }
  return "";
}

export function isCrossOrigin(a: URL, b: URL): boolean {
  return (
    a.protocol !== b.protocol ||
    a.hostname.toLowerCase() !== b.hostname.toLowerCase() ||
    effectivePort(a) !== effectivePort(b)
  );
}

export function buildDownloadHeaders(args: {
  readonly callHeaders: Record<string, string> | null | undefined;
  readonly startOffset: number;
  readonly attachAuth: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(args.callHeaders ?? {})) {
    const lower = key.toLowerCase();
    if (!args.attachAuth && (lower === "authorization" || lower === "proxy-authorization")) {
      continue;
    }
    headers[key] = value;
  }
  if (headers["User-Agent"] == null) {
    headers["User-Agent"] = "electron-builder";
  }
  headers["Cache-Control"] = "no-cache";
  if (args.startOffset > 0) {
    headers["Range"] = `bytes=${args.startOffset}-`;
  }
  return headers;
}

export function headerString(value: string | string[] | undefined): string | null {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value)) {
    return value;
  }
  return value.length === 0 ? null : (value[value.length - 1] ?? null);
}

export function parseIntOrNull(value: string | null): number | null {
  if (value == null) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildRequestOptions(
  url: URL,
  headers: Record<string, string>,
): Record<string, unknown> {
  const options: Record<string, unknown> = {
    protocol: url.protocol,
    hostname: url.hostname,
    path: `${url.pathname}${url.search}`,
    headers,
    redirect: "manual",
  };
  if (url.port) {
    options.port = url.port;
  }
  return options;
}
