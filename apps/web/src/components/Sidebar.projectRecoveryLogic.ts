// Project lookup, recovery, and add-project error helpers.

import type { ProjectId } from "@agent-group/contracts";
import { isWorkspaceRootWithin, workspaceRootsEqual } from "@agent-group/shared/threadWorkspace";
import { isDuplicateProjectCreateError } from "../lib/projectCreateRecovery";

export function findWorkspaceRootMatch<T>(
  items: readonly T[],
  targetWorkspaceRoot: string,
  getWorkspaceRoot: (item: T) => string,
): T | undefined {
  return items.find((item) => workspaceRootsEqual(getWorkspaceRoot(item), targetWorkspaceRoot));
}

// Finds the item whose workspace root most specifically contains `targetPath`
// (equal to it, or its closest ancestor). Used to attribute a dev server's cwd
// to a project even when it runs from a monorepo subdirectory; the deepest root
// wins so a nested project beats its parent.
export function findDeepestWorkspaceRootMatch<T>(
  items: readonly T[],
  targetPath: string,
  getWorkspaceRoot: (item: T) => string,
): T | undefined {
  let best: T | undefined;
  let bestRootLength = -1;
  for (const item of items) {
    const root = getWorkspaceRoot(item);
    if (!isWorkspaceRootWithin(targetPath, root)) {
      continue;
    }
    if (root.length > bestRootLength) {
      best = item;
      bestRootLength = root.length;
    }
  }
  return best;
}

// Rechecks an existing local project against the server before the add flow decides to reuse it.
export async function recoverExistingAddProjectTarget(input: {
  readonly existingProjectId: ProjectId | null | undefined;
  readonly workspaceRoot: string;
  readonly recoverByProjectId: (projectId: ProjectId) => Promise<boolean>;
  readonly recoverByWorkspaceRoot: (workspaceRoot: string) => Promise<boolean>;
}): Promise<"recovered" | "create"> {
  if (!input.existingProjectId) {
    return "create";
  }

  if (await input.recoverByProjectId(input.existingProjectId)) {
    return "recovered";
  }

  if (await input.recoverByWorkspaceRoot(input.workspaceRoot)) {
    return "recovered";
  }

  return "create";
}

// Translates low-level add-project failures into a short explanation without
// hiding the original error text that developers may need for diagnosis.
export function describeAddProjectError(message: string): string | null {
  if (isDuplicateProjectCreateError(message)) {
    return "This usually means the folder is already linked to an existing project. On Windows, the same folder can arrive with a different path format, so it looks new even when it is not.";
  }

  if (
    message.startsWith("Failed to create project directory: /") ||
    message.startsWith("Project directory does not exist: /")
  ) {
    return "This is an absolute path from the filesystem root. If the folder is in your home directory, use ~/Developer/... or the full /Users/<name>/Developer/... path.";
  }

  return null;
}
