import type { FileFilter } from "electron";
import type { DesktopTheme } from "@agent-group/contracts";
import { isBrokenPipeError } from "../desktopProcessErrors";

export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function safeConsoleError(...args: Parameters<typeof console.error>): void {
  try {
    console.error(...args);
  } catch (error: unknown) {
    if (!isBrokenPipeError(error)) throw error;
  }
}

export function getSafeExternalUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return null;
  try {
    const parsedUrl = new URL(rawUrl);
    return parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:"
      ? parsedUrl.toString()
      : null;
  } catch {
    return null;
  }
}

export function getSafeTheme(rawTheme: unknown): DesktopTheme | null {
  return rawTheme === "light" || rawTheme === "dark" || rawTheme === "system" ? rawTheme : null;
}

export function isSaveFileInput(input: unknown): input is {
  defaultFilename: string;
  contents: string;
  filters?: FileFilter[];
} {
  if (!input || typeof input !== "object") return false;
  const record = input as Record<string, unknown>;
  if (typeof record.defaultFilename !== "string" || record.defaultFilename.trim().length === 0) {
    return false;
  }
  if (typeof record.contents !== "string") return false;
  if (record.filters === undefined) return true;
  if (!Array.isArray(record.filters)) return false;
  return record.filters.every((filter) => {
    if (!filter || typeof filter !== "object") return false;
    const value = filter as Record<string, unknown>;
    return (
      typeof value.name === "string" &&
      Array.isArray(value.extensions) &&
      value.extensions.every((extension) => typeof extension === "string")
    );
  });
}
