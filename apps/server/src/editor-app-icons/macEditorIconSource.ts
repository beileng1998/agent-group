import fs from "node:fs/promises";
import path from "node:path";

import { getEditorMacApplications, resolveMacApplicationBundlePath } from "../editorAppDiscovery";
import {
  execFileAsync,
  fileExists,
  type EditorIconSource,
  type EditorIconSourceInput,
} from "./editorIconShared";

async function readPlistJson(infoPlistPath: string): Promise<Record<string, unknown> | null> {
  try {
    const { stdout } = await execFileAsync("plutil", [
      "-convert",
      "json",
      "-o",
      "-",
      infoPlistPath,
    ]);
    return JSON.parse(String(stdout)) as Record<string, unknown>;
  } catch {
    const xml = await fs.readFile(infoPlistPath, "utf8").catch(() => null);
    if (!xml) return null;
    return parseSimpleXmlPlist(xml);
  }
}

function parseSimpleXmlPlist(xml: string): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  const pairPattern = /<key>([^<]+)<\/key>\s*<string>([^<]+)<\/string>/g;
  for (const match of xml.matchAll(pairPattern)) {
    if (match[1] && match[2]) {
      result[match[1]] = match[2];
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function readNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function iconNamesFromInfoPlist(info: Record<string, unknown>): string[] {
  const names = [
    stringValue(info.CFBundleIconFile),
    stringValue(info.CFBundleIconName),
    ...stringArrayValue(
      readNestedRecord(
        readNestedRecord(readNestedRecord(info, "CFBundleIcons"), "CFBundlePrimaryIcon"),
        "CFBundleIconFiles",
      ),
    ),
  ];
  return Array.from(new Set(names.filter((name): name is string => name !== null)));
}

function iconFileCandidates(resourcesDir: string, iconName: string): string[] {
  if (path.extname(iconName)) return [path.join(resourcesDir, iconName)];
  return [
    path.join(resourcesDir, `${iconName}.icns`),
    path.join(resourcesDir, `${iconName}.png`),
    path.join(resourcesDir, `${iconName}.svg`),
  ];
}

async function findFirstIconInDirectory(dirPath: string): Promise<string | null> {
  const entries = await fs.readdir(dirPath).catch(() => []);
  const icon = entries.find((entry) => /\.(icns|png|svg)$/i.test(entry));
  return icon ? path.join(dirPath, icon) : null;
}

export async function resolveMacEditorIconSource(
  input: EditorIconSourceInput,
): Promise<EditorIconSource | null> {
  const bundlePath = resolveMacApplicationBundlePath(
    getEditorMacApplications(input.editor),
    input.platform,
    input.env,
  );
  if (!bundlePath) return null;

  const resourcesDir = path.join(bundlePath, "Contents", "Resources");
  const info = await readPlistJson(path.join(bundlePath, "Contents", "Info.plist"));
  const iconNames = info ? iconNamesFromInfoPlist(info) : [];
  const candidates = iconNames.flatMap((iconName) => iconFileCandidates(resourcesDir, iconName));

  const fallbackIcon = await findFirstIconInDirectory(resourcesDir);
  if (fallbackIcon) candidates.push(fallbackIcon);

  for (const candidate of candidates) {
    if (!(await fileExists(candidate))) continue;
    const extension = path.extname(candidate).toLowerCase();
    if (extension === ".icns") {
      return {
        sourcePath: candidate,
        outputExtension: "png",
        contentType: "image/png",
        transform: "sips-icns",
      };
    }
    if (extension === ".png") {
      return {
        sourcePath: candidate,
        outputExtension: "png",
        contentType: "image/png",
        transform: "copy",
      };
    }
    if (extension === ".svg") {
      return {
        sourcePath: candidate,
        outputExtension: "svg",
        contentType: "image/svg+xml",
        transform: "copy",
      };
    }
  }

  return null;
}
