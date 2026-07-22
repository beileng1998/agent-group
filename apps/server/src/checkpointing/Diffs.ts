// FILE: Diffs.ts
// Purpose: Parses unified diffs into turn/checkpoint file summaries.
// Layer: Server checkpointing helper
// Exports: turn diff file parsers used by checkpoint capture and provider live-diff ingestion

import type { OrchestrationCheckpointFile } from "@agent-group/contracts";
import { decodeGitQuotedPath } from "@agent-group/shared/gitQuotedPath";
import { parsePatchFiles } from "@pierre/diffs";

export interface TurnDiffFileSummary {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export function parseTurnDiffFilesFromUnifiedDiff(
  diff: string,
): ReadonlyArray<TurnDiffFileSummary> {
  const normalized = diff.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return [];
  }

  const parsedPatches = parsePatchFiles(normalized);
  const filesByPath = new Map<string, TurnDiffFileSummary>();
  for (const patch of parsedPatches) {
    for (const file of patch.files) {
      const filePath = decodeGitQuotedPath(file.name);
      const additions = file.hunks.reduce((total, hunk) => total + hunk.additionLines, 0);
      const deletions = file.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0);
      const existing = filesByPath.get(filePath);
      filesByPath.set(filePath, {
        path: filePath,
        additions: (existing?.additions ?? 0) + additions,
        deletions: (existing?.deletions ?? 0) + deletions,
      });
    }
  }

  return Array.from(filesByPath.values()).toSorted((left, right) =>
    left.path.localeCompare(right.path),
  );
}

export function parseCheckpointFilesFromUnifiedDiff(diff: string): OrchestrationCheckpointFile[] {
  return parseTurnDiffFilesFromUnifiedDiff(diff).map((file) => ({
    path: file.path,
    kind: "modified",
    additions: file.additions,
    deletions: file.deletions,
  }));
}
