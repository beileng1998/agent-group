// FILE: codexVisualizations.ts
// Purpose: Capture Codex inline fragments into a durable, read-only server artifact store.
// Layer: Server provider utility

import { createHash } from "node:crypto";
import { constants as fileSystemConstants } from "node:fs";
import { copyFile, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  extractCodexInlineVisualizationDirectives,
  isCodexVisualizationFileName,
  MAX_CODEX_VISUALIZATION_BYTES,
} from "@agent-group/shared/codexVisualizations";

const VISUALIZATION_DIRECTORY = "codex-visualizations";
const SAFE_THREAD_DIRECTORY_PATTERN = /^[a-zA-Z0-9_-]{1,160}$/u;

export interface CapturedCodexVisualization {
  readonly fileName: string;
  readonly path: string;
}

function stablePathSegment(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function dateDirectories(createdAt: string): string[][] {
  const parsed = new Date(createdAt);
  const baseTime = Number.isNaN(parsed.getTime()) ? Date.now() : parsed.getTime();
  const candidates: string[][] = [];
  const seen = new Set<string>();
  const add = (parts: string[]) => {
    const key = parts.join("/");
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(parts);
    }
  };
  for (const dayOffset of [0, -1, 1]) {
    const date = new Date(baseTime + dayOffset * 24 * 60 * 60 * 1_000);
    add([
      String(date.getFullYear()),
      padDatePart(date.getMonth() + 1),
      padDatePart(date.getDate()),
    ]);
    add([
      String(date.getUTCFullYear()),
      padDatePart(date.getUTCMonth() + 1),
      padDatePart(date.getUTCDate()),
    ]);
  }
  return candidates;
}

function uniqueSafeThreadDirectories(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].filter((value) =>
    SAFE_THREAD_DIRECTORY_PATTERN.test(value),
  );
}

async function resolveTrustedVisualizationSource(input: {
  readonly workspaceRoot: string;
  readonly threadDirectories: readonly string[];
  readonly fileName: string;
  readonly createdAt: string;
}): Promise<string | null> {
  const visualizationRoot = path.resolve(input.workspaceRoot, ".codex", "visualizations");
  const realVisualizationRoot = await realpath(visualizationRoot).catch(() => null);
  if (!realVisualizationRoot) return null;

  for (const dateDirectory of dateDirectories(input.createdAt)) {
    for (const threadDirectory of input.threadDirectories) {
      const candidate = path.join(
        visualizationRoot,
        ...dateDirectory,
        threadDirectory,
        input.fileName,
      );
      const realCandidate = await realpath(candidate).catch(() => null);
      if (!realCandidate || !isPathInside(realCandidate, realVisualizationRoot)) continue;
      const info = await stat(realCandidate).catch(() => null);
      if (info?.isFile() && info.size <= MAX_CODEX_VISUALIZATION_BYTES) return realCandidate;
    }
  }
  return null;
}

export function codexVisualizationArtifactRoot(stateDir: string): string {
  return path.join(stateDir, VISUALIZATION_DIRECTORY);
}

export function codexVisualizationThreadArtifactDirectory(
  stateDir: string,
  threadId: string,
): string {
  return path.join(codexVisualizationArtifactRoot(stateDir), stablePathSegment(threadId));
}

function artifactPath(input: {
  readonly stateDir: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly fileName: string;
}): string {
  return path.join(
    codexVisualizationThreadArtifactDirectory(input.stateDir, input.threadId),
    stablePathSegment(input.messageId),
    input.fileName,
  );
}

export async function captureCodexInlineVisualizations(input: {
  readonly stateDir: string;
  readonly workspaceRoot: string;
  readonly threadId: string;
  readonly providerThreadId?: string;
  readonly messageId: string;
  readonly createdAt: string;
  readonly text: string;
}): Promise<CapturedCodexVisualization[]> {
  const directives = extractCodexInlineVisualizationDirectives(input.text);
  if (directives.length === 0) return [];

  const threadDirectories = uniqueSafeThreadDirectories([
    input.threadId,
    input.providerThreadId,
  ]);
  const captured: CapturedCodexVisualization[] = [];
  for (const directive of directives) {
    const source = await resolveTrustedVisualizationSource({
      workspaceRoot: input.workspaceRoot,
      threadDirectories,
      fileName: directive.fileName,
      createdAt: input.createdAt,
    });
    if (!source) continue;
    const destination = artifactPath({
      stateDir: input.stateDir,
      threadId: input.threadId,
      messageId: input.messageId,
      fileName: directive.fileName,
    });
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination, fileSystemConstants.COPYFILE_EXCL).catch((error) => {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw error;
      }
    });
    captured.push({ fileName: directive.fileName, path: destination });
  }
  return captured;
}

export async function resolveCodexVisualizationArtifact(input: {
  readonly stateDir: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly fileName: string;
}): Promise<{ readonly path: string; readonly sizeBytes: number } | null> {
  if (!isCodexVisualizationFileName(input.fileName)) return null;
  const artifactRoot = codexVisualizationArtifactRoot(input.stateDir);
  const candidate = artifactPath(input);
  const [realRoot, realCandidate] = await Promise.all([
    realpath(artifactRoot).catch(() => null),
    realpath(candidate).catch(() => null),
  ]);
  if (!realRoot || !realCandidate || !isPathInside(realCandidate, realRoot)) return null;
  const info = await stat(realCandidate).catch(() => null);
  if (!info?.isFile() || info.size > MAX_CODEX_VISUALIZATION_BYTES) return null;
  return { path: realCandidate, sizeBytes: info.size };
}
