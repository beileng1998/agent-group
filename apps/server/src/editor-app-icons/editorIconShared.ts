import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { EditorDefinition } from "../editorAppDiscovery";

export const execFileAsync = promisify(execFile);

// Editor rows render at ~14px. Cap the cached raster so a 512-1024px .icns is not
// served (and re-decoded) at full resolution on every menu open; 128px stays crisp
// on hi-dpi while shrinking payloads by one to two orders of magnitude.
export const ICON_MAX_DIMENSION_PX = 128;

export interface CachedEditorIcon {
  readonly path: string;
  readonly contentType: string;
}

export interface EditorIconSource {
  readonly sourcePath: string;
  readonly outputExtension: "png" | "svg";
  readonly contentType: string;
  readonly transform: "copy" | "sips-icns" | "windows-associated-icon";
}

export interface EditorIconSourceInput {
  readonly editor: EditorDefinition;
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export function resolvePathEnvironmentVariable(env: NodeJS.ProcessEnv): string {
  return env.PATH ?? env.Path ?? env.path ?? "";
}

function resolveWindowsPathExtensions(env: NodeJS.ProcessEnv): string[] {
  const rawValue = env.PATHEXT;
  const fallback = [".COM", ".EXE", ".BAT", ".CMD"];
  if (!rawValue) return fallback;
  return rawValue
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry.toUpperCase() : `.${entry.toUpperCase()}`));
}

export async function resolveCommandPath(input: {
  readonly commands: readonly string[] | null;
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
}): Promise<string | null> {
  if (!input.commands) return null;
  const pathValue = resolvePathEnvironmentVariable(input.env);
  if (pathValue.length === 0) return null;
  const delimiter = input.platform === "win32" ? ";" : ":";
  const pathEntries = pathValue
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"+|"+$/g, ""))
    .filter(Boolean);
  const pathExtensions =
    input.platform === "win32" ? resolveWindowsPathExtensions(input.env) : [""];

  for (const command of input.commands) {
    const commandCandidates =
      input.platform === "win32" && !path.extname(command)
        ? pathExtensions.map((extension) => `${command}${extension}`)
        : [command];
    for (const pathEntry of pathEntries) {
      for (const commandCandidate of commandCandidates) {
        const candidate = path.join(pathEntry, commandCandidate);
        if (await fileExists(candidate)) return candidate;
      }
    }
  }
  return null;
}
