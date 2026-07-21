// FILE: local-server-monitor/pageTitles.ts
// Purpose: Resolves bounded, cached HTML titles for local/private development servers.
// Layer: Local-server discovery enrichment.

import type { ServerLocalServerAddress, ServerLocalServerProcess } from "@agent-group/contracts";

const PAGE_TITLE_MAX_CHARS = 200;
const PAGE_TITLE_FETCH_TIMEOUT_MS = 650;
const PAGE_TITLE_MAX_BYTES = 128 * 1024;
const PAGE_TITLE_SUCCESS_TTL_MS = 30_000;
const PAGE_TITLE_FAILURE_TTL_MS = 10_000;
const PAGE_TITLE_FETCH_CONCURRENCY = 4;
const PAGE_TITLE_MAX_URLS_PER_SERVER = 3;
const PAGE_TITLE_REDIRECT_LIMIT = 3;
const PAGE_TITLE_CACHE_MAX = 250;

interface CachedPageTitle {
  readonly title: string | null;
  readonly expiresAtMs: number;
}

const pageTitleCache = new Map<string, CachedPageTitle>();
const pageTitleInFlight = new Map<string, Promise<string | null>>();

function normalizePageTitle(input: string): string | null {
  const stripped = input.replace(/<[^>]*>/g, " ");
  const decoded = stripped
    .replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (match, entity) => {
      const normalized = entity.toLowerCase();
      if (normalized === "amp") return "&";
      if (normalized === "apos") return "'";
      if (normalized === "gt") return ">";
      if (normalized === "lt") return "<";
      if (normalized === "nbsp") return " ";
      if (normalized === "quot") return '"';
      if (normalized.startsWith("#x")) {
        const codePoint = Number.parseInt(normalized.slice(2), 16);
        return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : match;
      }
      if (normalized.startsWith("#")) {
        const codePoint = Number.parseInt(normalized.slice(1), 10);
        return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : match;
      }
      return match;
    })
    .replace(/\s+/g, " ")
    .trim();

  if (decoded.length === 0) {
    return null;
  }
  return decoded.length <= PAGE_TITLE_MAX_CHARS
    ? decoded
    : `${decoded.slice(0, PAGE_TITLE_MAX_CHARS - 3).trimEnd()}...`;
}

function extractMetaContent(html: string, names: readonly string[]): string | null {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const rawTag = tag[0];
    const nameMatch = /\b(?:name|property)=["']?([^"'\s>]+)["']?/i.exec(rawTag);
    if (!nameMatch || !names.includes(nameMatch[1]?.toLowerCase() ?? "")) {
      continue;
    }
    const contentMatch =
      /\bcontent=(["'])(.*?)\1/i.exec(rawTag) ?? /\bcontent=([^"'\s>]+)/i.exec(rawTag);
    const content = contentMatch?.[2] ?? contentMatch?.[1] ?? "";
    const normalized = normalizePageTitle(content);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

// Pulls a human label from small HTML previews without depending on a DOM runtime.
export function extractLocalServerPageTitle(html: string): string | null {
  const metaTitle = extractMetaContent(html, ["application-name", "og:title", "twitter:title"]);
  if (metaTitle) {
    return metaTitle;
  }

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return titleMatch ? normalizePageTitle(titleMatch[1] ?? "") : null;
}

async function readResponsePrefix(response: Response): Promise<string> {
  const body = response.body;
  if (!body) {
    return "";
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;
  try {
    while (bytesRead < PAGE_TITLE_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const nextChunk = value.slice(0, Math.max(0, PAGE_TITLE_MAX_BYTES - bytesRead));
      bytesRead += nextChunk.byteLength;
      text += decoder.decode(nextChunk, { stream: true });
      if (bytesRead >= PAGE_TITLE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } finally {
    text += decoder.decode();
  }
  return text;
}

function parseIpv4Host(host: string): readonly [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN)) as [
    number,
    number,
    number,
    number,
  ];
  return bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255) ? bytes : null;
}

function isLocalPageTitleHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::" || host === "::1") {
    return true;
  }
  if (host.startsWith("::ffff:")) {
    return isLocalPageTitleHost(host.slice("::ffff:".length));
  }
  if (
    host.includes(":") &&
    (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:"))
  ) {
    return true;
  }

  const ipv4 = parseIpv4Host(host);
  if (!ipv4) {
    return false;
  }
  const [first, second] = ipv4;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

// Title probes must stay on local/private hosts even when a dev server redirects.
function isLocalPageTitleProbeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      isLocalPageTitleHost(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function resolveLocalPageTitleRedirect(location: string | null, currentUrl: string): string | null {
  if (!location) {
    return null;
  }
  try {
    const nextUrl = new URL(location, currentUrl).toString();
    return isLocalPageTitleProbeUrl(nextUrl) ? nextUrl : null;
  } catch {
    return null;
  }
}

async function fetchLocalPageTitleResponse(
  url: string,
  redirectsRemaining = PAGE_TITLE_REDIRECT_LIMIT,
): Promise<Response | null> {
  if (!isLocalPageTitleProbeUrl(url)) {
    return null;
  }
  const response = await globalThis.fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(PAGE_TITLE_FETCH_TIMEOUT_MS),
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
      "User-Agent": "AgentGroupLocalServerMonitor/1.0",
    },
  });
  if (response.status >= 300 && response.status < 400) {
    if (redirectsRemaining <= 0) {
      return null;
    }
    const redirectUrl = resolveLocalPageTitleRedirect(response.headers.get("location"), url);
    return redirectUrl ? fetchLocalPageTitleResponse(redirectUrl, redirectsRemaining - 1) : null;
  }
  return response;
}

async function fetchPageTitleFromUrl(url: string): Promise<string | null> {
  try {
    const response = await fetchLocalPageTitleResponse(url);
    if (!response?.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType && !/(?:text\/html|application\/xhtml\+xml)/.test(contentType)) {
      return null;
    }

    return extractLocalServerPageTitle(await readResponsePrefix(response));
  } catch {
    return null;
  }
}

function storePageTitleCacheEntry(url: string, entry: CachedPageTitle): void {
  pageTitleCache.set(url, entry);
  while (pageTitleCache.size > PAGE_TITLE_CACHE_MAX) {
    const oldestKey = pageTitleCache.keys().next().value as string | undefined;
    if (!oldestKey || oldestKey === url) {
      break;
    }
    pageTitleCache.delete(oldestKey);
  }
}

async function resolvePageTitleFromUrl(url: string): Promise<string | null> {
  const now = Date.now();
  const cached = pageTitleCache.get(url);
  if (cached && cached.expiresAtMs > now) {
    return cached.title;
  }

  const pending = pageTitleInFlight.get(url);
  if (pending) {
    return pending;
  }

  const promise = fetchPageTitleFromUrl(url)
    .then((title) => {
      storePageTitleCacheEntry(url, {
        title,
        expiresAtMs: Date.now() + (title ? PAGE_TITLE_SUCCESS_TTL_MS : PAGE_TITLE_FAILURE_TTL_MS),
      });
      return title;
    })
    .finally(() => {
      pageTitleInFlight.delete(url);
    });

  pageTitleInFlight.set(url, promise);
  return promise;
}

function localServerCandidateUrls(
  addresses: readonly Pick<ServerLocalServerAddress, "url">[],
): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const address of addresses) {
    if (!address.url || seen.has(address.url)) {
      continue;
    }
    seen.add(address.url);
    urls.push(address.url);
    if (urls.length >= PAGE_TITLE_MAX_URLS_PER_SERVER) {
      break;
    }
  }
  return urls;
}

function pageTitleCandidateUrls(server: ServerLocalServerProcess): string[] {
  return localServerCandidateUrls(server.addresses);
}

async function firstResolvedPageTitle(
  urls: readonly string[],
  fetchTitle: (url: string) => Promise<string | null>,
): Promise<string | null> {
  for (const url of urls) {
    const title = await fetchTitle(url);
    if (title) {
      return title;
    }
  }
  return null;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function enrichLocalServerProcessesWithPageTitles(
  servers: readonly ServerLocalServerProcess[],
  fetchTitle: (url: string) => Promise<string | null> = resolvePageTitleFromUrl,
): Promise<ServerLocalServerProcess[]> {
  return mapWithConcurrency(servers, PAGE_TITLE_FETCH_CONCURRENCY, async (server) => {
    const pageTitle = await firstResolvedPageTitle(pageTitleCandidateUrls(server), fetchTitle);
    return pageTitle ? { ...server, pageTitle } : server;
  });
}
