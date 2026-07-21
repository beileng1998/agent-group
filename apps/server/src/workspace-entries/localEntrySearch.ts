import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  ProjectLocalSearchEntry,
  ProjectSearchLocalEntriesInput,
  ProjectSearchLocalEntriesResult,
} from "@agent-group/contracts";
import { mapWithConcurrency, normalizeQuery, scoreSubsequenceMatch } from "./workspaceEntryValues";

const LOCAL_SEARCH_MAX_DEPTH = 6;
const LOCAL_SEARCH_DEFAULT_LIMIT = 50;
const LOCAL_SEARCH_TIME_BUDGET_MS = 600;
const LOCAL_SEARCH_READDIR_CONCURRENCY = 16;
// Directory names to skip during recursive local search. These are either
// high-volume caches or user-private areas that would blow up a walk without
// producing useful matches for a composer mention.
const LOCAL_SEARCH_IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".DS_Store",
  ".Trash",
  "node_modules",
  ".next",
  ".turbo",
  ".cache",
  ".convex",
  ".pnpm-store",
  ".yarn",
  ".gradle",
  ".m2",
  ".nuget",
  ".bundle",
  "Library",
  "Pods",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
]);

interface RankedLocalSearchEntry {
  entry: ProjectLocalSearchEntry;
  score: number;
}

function compareRankedLocalSearchEntries(
  left: RankedLocalSearchEntry,
  right: RankedLocalSearchEntry,
): number {
  const scoreDelta = left.score - right.score;
  if (scoreDelta !== 0) return scoreDelta;
  return left.entry.path.localeCompare(right.entry.path);
}

function insertRankedLocalEntry(
  ranked: RankedLocalSearchEntry[],
  candidate: RankedLocalSearchEntry,
  limit: number,
): void {
  if (limit <= 0) return;

  let low = 0;
  let high = ranked.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const current = ranked[middle];
    if (!current) break;
    if (compareRankedLocalSearchEntries(candidate, current) < 0) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  if (ranked.length < limit) {
    ranked.splice(low, 0, candidate);
    return;
  }
  if (low >= limit) return;
  ranked.splice(low, 0, candidate);
  ranked.pop();
}

function scoreLocalName(name: string, query: string): number | null {
  const normalizedName = name.toLowerCase();
  if (normalizedName === query) return 0;
  if (normalizedName.startsWith(query)) return 2;
  if (normalizedName.includes(query)) return 5;
  const fuzzy = scoreSubsequenceMatch(normalizedName, query);
  if (fuzzy !== null) return 100 + fuzzy;
  return null;
}

export async function searchLocalEntries(
  input: ProjectSearchLocalEntriesInput,
): Promise<ProjectSearchLocalEntriesResult> {
  const normalizedQuery = normalizeQuery(input.query);
  if (normalizedQuery.length === 0) {
    return { entries: [], truncated: false };
  }

  const limit = Math.max(
    1,
    Math.min(input.limit ?? LOCAL_SEARCH_DEFAULT_LIMIT, LOCAL_SEARCH_DEFAULT_LIMIT),
  );
  const includeFiles = input.includeFiles !== false;
  // When the user explicitly searches for a dotfile prefix (`.ss`, `.en`) surface
  // hidden entries; otherwise skip them so the walk is bounded and predictable.
  const includeDotfiles = normalizedQuery.startsWith(".");
  const deadline = Date.now() + LOCAL_SEARCH_TIME_BUDGET_MS;

  const ranked: RankedLocalSearchEntry[] = [];
  let truncated = false;
  let currentLevel: Array<{ absolutePath: string; depth: number }> = [
    { absolutePath: input.rootPath, depth: 0 },
  ];

  while (currentLevel.length > 0) {
    if (Date.now() > deadline) {
      truncated = true;
      break;
    }

    const nextLevel: Array<{ absolutePath: string; depth: number }> = [];
    await mapWithConcurrency(
      currentLevel,
      LOCAL_SEARCH_READDIR_CONCURRENCY,
      async ({ absolutePath, depth }) => {
        if (Date.now() > deadline) return;
        let dirents: Dirent[];
        try {
          dirents = await fs.readdir(absolutePath, { withFileTypes: true });
        } catch {
          return;
        }

        for (const dirent of dirents) {
          const name = dirent.name;
          if (!name || name === "." || name === "..") continue;
          if (LOCAL_SEARCH_IGNORED_DIRECTORY_NAMES.has(name)) continue;
          if (!includeDotfiles && name.startsWith(".")) continue;

          const isDirectory = dirent.isDirectory();
          const isFile = dirent.isFile();
          if (!isDirectory && !isFile) continue;
          if (!includeFiles && !isDirectory) continue;

          const childAbsolutePath = path.join(absolutePath, name);

          const score = scoreLocalName(name, normalizedQuery);
          if (score !== null) {
            insertRankedLocalEntry(
              ranked,
              {
                entry: {
                  path: childAbsolutePath,
                  name,
                  kind: isDirectory ? "directory" : "file",
                  parentPath: absolutePath,
                },
                score,
              },
              limit,
            );
          }

          if (isDirectory && depth + 1 < LOCAL_SEARCH_MAX_DEPTH) {
            nextLevel.push({ absolutePath: childAbsolutePath, depth: depth + 1 });
          }
        }
      },
    );

    currentLevel = nextLevel;
  }

  return {
    entries: ranked.map((candidate) => candidate.entry),
    truncated,
  };
}
