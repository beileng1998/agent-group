import { brotliCompress, constants, gzip } from "node:zlib";

export type StaticContentEncoding = "br" | "gzip";

const MIN_COMPRESSIBLE_BYTES = 1_024;
const MAX_CACHE_ENTRIES = 256;
const compressedAssetCache = new Map<string, Promise<Uint8Array>>();

const COMPRESSIBLE_APPLICATION_TYPES = new Set([
  "application/javascript",
  "application/json",
  "application/manifest+json",
  "application/wasm",
  "application/xml",
  "image/svg+xml",
]);

function encodingQuality(header: string, encoding: StaticContentEncoding): number {
  let wildcardQuality = 0;
  for (const entry of header.toLowerCase().split(",")) {
    const [rawName, ...parameters] = entry.trim().split(";");
    const name = rawName?.trim();
    const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith("q="));
    const parsedQuality = qualityParameter
      ? Number.parseFloat(qualityParameter.trim().slice(2))
      : 1;
    const quality = Number.isFinite(parsedQuality) ? Math.min(1, Math.max(0, parsedQuality)) : 0;
    if (name === encoding) return quality;
    if (name === "*") wildcardQuality = quality;
  }
  return wildcardQuality;
}

export function selectStaticContentEncoding(
  acceptEncoding: string | undefined,
): StaticContentEncoding | null {
  if (!acceptEncoding) return null;
  const brotliQuality = encodingQuality(acceptEncoding, "br");
  const gzipQuality = encodingQuality(acceptEncoding, "gzip");
  if (brotliQuality <= 0 && gzipQuality <= 0) return null;
  return brotliQuality >= gzipQuality ? "br" : "gzip";
}

export function staticCacheControl(pathname: string, contentType: string): string {
  if (contentType.startsWith("text/html") || pathname === "/sw.js") return "no-cache";
  if (pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

function isCompressible(contentType: string, byteLength: number): boolean {
  if (byteLength < MIN_COMPRESSIBLE_BYTES) return false;
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType.startsWith("text/") || COMPRESSIBLE_APPLICATION_TYPES.has(mediaType);
}

function compress(data: Uint8Array, encoding: StaticContentEncoding): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const done = (error: Error | null, result: Buffer) => {
      if (error) reject(error);
      else resolve(result);
    };
    if (encoding === "br") {
      brotliCompress(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }, done);
      return;
    }
    gzip(data, { level: 6 }, done);
  });
}

/** Compresses a dynamic response without retaining its private contents in the asset cache. */
export async function prepareCompressedResponseBody(
  data: Uint8Array,
  acceptEncoding: string | undefined,
): Promise<{ readonly body: Uint8Array; readonly headers: Record<string, string> }> {
  if (data.byteLength < MIN_COMPRESSIBLE_BYTES) return { body: data, headers: {} };
  const headers: Record<string, string> = { Vary: "Accept-Encoding" };
  const encoding = selectStaticContentEncoding(acceptEncoding);
  if (!encoding) return { body: data, headers };
  try {
    const body = await compress(data, encoding);
    if (body.byteLength >= data.byteLength) return { body: data, headers };
    headers["Content-Encoding"] = encoding;
    return { body, headers };
  } catch {
    return { body: data, headers };
  }
}

function compressedAsset(
  cacheKey: string,
  data: Uint8Array,
  encoding: StaticContentEncoding,
): Promise<Uint8Array> {
  const existing = compressedAssetCache.get(cacheKey);
  if (existing) {
    compressedAssetCache.delete(cacheKey);
    compressedAssetCache.set(cacheKey, existing);
    return existing;
  }

  const pending = compress(data, encoding);
  compressedAssetCache.set(cacheKey, pending);
  if (compressedAssetCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = compressedAssetCache.keys().next().value;
    if (oldestKey) compressedAssetCache.delete(oldestKey);
  }
  void pending.catch(() => {
    if (compressedAssetCache.get(cacheKey) === pending) compressedAssetCache.delete(cacheKey);
  });
  return pending;
}

export async function prepareStaticAsset(input: {
  readonly pathname: string;
  readonly filePath: string;
  readonly version: string;
  readonly contentType: string;
  readonly acceptEncoding: string | undefined;
  readonly data: Uint8Array;
}): Promise<{ readonly body: Uint8Array; readonly headers: Record<string, string> }> {
  const headers: Record<string, string> = {
    "Cache-Control": staticCacheControl(input.pathname, input.contentType),
  };
  if (!isCompressible(input.contentType, input.data.byteLength)) {
    return { body: input.data, headers };
  }

  headers.Vary = "Accept-Encoding";
  const encoding = selectStaticContentEncoding(input.acceptEncoding);
  if (!encoding) return { body: input.data, headers };

  try {
    const body = await compressedAsset(
      `${input.filePath}:${input.version}:${encoding}`,
      input.data,
      encoding,
    );
    if (body.byteLength >= input.data.byteLength) return { body: input.data, headers };
    headers["Content-Encoding"] = encoding;
    return { body, headers };
  } catch {
    return { body: input.data, headers };
  }
}
