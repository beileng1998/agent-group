import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getEditorMacApplications, type EditorDefinition } from "../editorAppDiscovery";
import {
  directoryExists,
  fileExists,
  type EditorIconSource,
  type EditorIconSourceInput,
} from "./editorIconShared";

const MAX_DESKTOP_FILES_TO_SCAN = 1_500;
const MAX_ICON_FILES_TO_SCAN = 8_000;

function desktopSearchDirs(env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME?.trim() || os.homedir();
  const dataHome = env.XDG_DATA_HOME?.trim() || path.join(home, ".local", "share");
  const dataDirs =
    env.XDG_DATA_DIRS !== undefined
      ? env.XDG_DATA_DIRS.split(":").filter(Boolean)
      : ["/usr/local/share", "/usr/share"];
  return [
    path.join(dataHome, "applications"),
    path.join(dataHome, "flatpak", "exports", "share", "applications"),
    ...dataDirs.map((dir) => path.join(dir, "applications")),
    "/var/lib/flatpak/exports/share/applications",
    "/snap",
  ];
}

function normalizeDesktopMatchValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function desktopIdentityTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map(normalizeDesktopMatchValue)
    .filter(Boolean);
}

function parseDesktopEntryValues(content: string, key: string): string[] {
  const escapedKey = key.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*${escapedKey}(?:\\[[^\\]]+\\])?\\s*=\\s*(.+?)\\s*$`, "gim");
  return Array.from(content.matchAll(pattern), (match) => match[1]?.trim() ?? "").filter(Boolean);
}

function editorIdentityCandidates(editor: EditorDefinition): string[] {
  return [editor.id, editor.label, ...(getEditorMacApplications(editor) ?? [])]
    .map(normalizeDesktopMatchValue)
    .filter(Boolean);
}

function editorCommandCandidates(editor: EditorDefinition): ReadonlySet<string> {
  return new Set(
    (editor.commands ?? [])
      .map((command) =>
        normalizeDesktopMatchValue(
          path.basename(command).replace(/\.(?:bat|cmd|com|exe|sh)$/i, ""),
        ),
      )
      .filter(Boolean),
  );
}

function identityValueMatchesCandidate(value: string, candidates: readonly string[]): boolean {
  const normalizedValue = normalizeDesktopMatchValue(value);
  const tokens = desktopIdentityTokens(value);
  return candidates.some((candidate) => {
    if (normalizedValue === candidate || tokens.includes(candidate)) return true;
    // Keep suffix/contains matching for long product names while avoiding short false positives.
    return (
      candidate.length >= 5 &&
      (normalizedValue.endsWith(candidate) || normalizedValue.includes(candidate))
    );
  });
}

function splitDesktopExecTokens(execValue: string): string[] {
  const withoutFieldCodes = execValue.replace(/%[a-zA-Z]/g, " ");
  const tokenPattern = /"([^"]+)"|'([^']+)'|(\S+)/g;
  return Array.from(
    withoutFieldCodes.matchAll(tokenPattern),
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  ).filter(Boolean);
}

function normalizeDesktopExecToken(token: string): string {
  return normalizeDesktopMatchValue(path.basename(token).replace(/\.(?:bat|cmd|com|exe|sh)$/i, ""));
}

function desktopFileMatchesEditor(
  content: string,
  desktopPath: string,
  editor: EditorDefinition,
): boolean {
  const identityCandidates = editorIdentityCandidates(editor);
  const identityValues = [
    path.basename(desktopPath, ".desktop"),
    ...parseDesktopEntryValues(content, "Name"),
    ...parseDesktopEntryValues(content, "StartupWMClass"),
  ];
  if (identityValues.some((value) => identityValueMatchesCandidate(value, identityCandidates))) {
    return true;
  }

  const commandCandidates = editorCommandCandidates(editor);
  return parseDesktopEntryValues(content, "Exec").some((execValue) =>
    splitDesktopExecTokens(execValue)
      .map(normalizeDesktopExecToken)
      .some((token) => commandCandidates.has(token)),
  );
}

async function findDesktopFile(
  editor: EditorDefinition,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  let scanned = 0;
  for (const dir of desktopSearchDirs(env)) {
    if (!(await directoryExists(dir))) continue;
    const pendingDirs = [dir];
    while (pendingDirs.length > 0) {
      const currentDir = pendingDirs.pop();
      if (!currentDir) continue;
      const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (++scanned > MAX_DESKTOP_FILES_TO_SCAN) return null;
        const candidate = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          pendingDirs.push(candidate);
          continue;
        }
        if (!entry.name.endsWith(".desktop") || !(await fileExists(candidate))) continue;
        const content = await fs.readFile(candidate, "utf8").catch(() => null);
        if (content && desktopFileMatchesEditor(content, candidate, editor)) return candidate;
      }
    }
  }
  return null;
}

function parseDesktopIconName(content: string): string | null {
  const match = /^Icon=(.+)$/m.exec(content);
  return match?.[1]?.trim() || null;
}

function linuxIconSearchDirs(env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME?.trim() || os.homedir();
  const dataHome = env.XDG_DATA_HOME?.trim() || path.join(home, ".local", "share");
  const dataDirs =
    env.XDG_DATA_DIRS !== undefined
      ? env.XDG_DATA_DIRS.split(":").filter(Boolean)
      : ["/usr/local/share", "/usr/share"];
  return [
    path.join(dataHome, "icons"),
    path.join(home, ".icons"),
    ...dataDirs.map((dir) => path.join(dir, "icons")),
    "/usr/share/pixmaps",
  ];
}

async function findIconByName(iconName: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  if (path.isAbsolute(iconName)) return (await fileExists(iconName)) ? iconName : null;

  const extensions = [".png", ".svg"];
  let scanned = 0;
  for (const dir of linuxIconSearchDirs(env)) {
    if (!(await directoryExists(dir))) continue;
    const pendingDirs = [dir];
    while (pendingDirs.length > 0) {
      const currentDir = pendingDirs.pop();
      if (!currentDir) continue;
      const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (++scanned > MAX_ICON_FILES_TO_SCAN) return null;
        const candidate = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          pendingDirs.push(candidate);
          continue;
        }
        if (!extensions.some((extension) => entry.name === `${iconName}${extension}`)) continue;
        if (await fileExists(candidate)) return candidate;
      }
    }
  }
  return null;
}

export async function resolveLinuxEditorIconSource(
  input: EditorIconSourceInput,
): Promise<EditorIconSource | null> {
  if (input.platform !== "linux") return null;
  const desktopFile = await findDesktopFile(input.editor, input.env);
  if (!desktopFile) return null;
  const content = await fs.readFile(desktopFile, "utf8").catch(() => null);
  const iconName = content ? parseDesktopIconName(content) : null;
  if (!iconName) return null;
  const iconPath = await findIconByName(iconName, input.env);
  if (!iconPath) return null;
  const extension = path.extname(iconPath).toLowerCase();
  if (extension === ".svg") {
    return {
      sourcePath: iconPath,
      outputExtension: "svg",
      contentType: "image/svg+xml",
      transform: "copy",
    };
  }
  return {
    sourcePath: iconPath,
    outputExtension: "png",
    contentType: "image/png",
    transform: "copy",
  };
}
