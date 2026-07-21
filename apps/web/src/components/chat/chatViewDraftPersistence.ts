import type { NativeApi, OrchestrationShellSnapshot, ProjectId } from "@agent-group/contracts";

export const LOCAL_PROJECT_DRAFT_CONTEXT = {
  envMode: "local",
  worktreePath: null,
  branch: null,
  lastKnownPr: null,
} as const;

const DRAFT_PROJECT_SYNC_MAX_ATTEMPTS = 6;
const DRAFT_PROJECT_SYNC_DELAY_MS = 50;

function waitForDraftProjectSyncDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

// Waits for a project to appear in the shell snapshot before a local draft points at it.
export async function waitForShellProjectById(
  api: NativeApi,
  projectId: ProjectId,
): Promise<{
  project: OrchestrationShellSnapshot["projects"][number] | null;
  snapshot: OrchestrationShellSnapshot | null;
}> {
  let latestSnapshot: OrchestrationShellSnapshot | null = null;
  for (let attempt = 1; attempt <= DRAFT_PROJECT_SYNC_MAX_ATTEMPTS; attempt += 1) {
    const snapshot = await api.orchestration.getShellSnapshot().catch(() => null);
    if (snapshot) {
      latestSnapshot = snapshot;
      const project = snapshot.projects.find((candidate) => candidate.id === projectId) ?? null;
      if (project) {
        return { project, snapshot };
      }
    }
    if (attempt < DRAFT_PROJECT_SYNC_MAX_ATTEMPTS) {
      await waitForDraftProjectSyncDelay(DRAFT_PROJECT_SYNC_DELAY_MS * attempt);
    }
  }
  return { project: null, snapshot: latestSnapshot };
}

function normalizeRestoredQueuedPrompt(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function composerPromptStillMatchesRestoredQueuedDraft(
  restoredPrompt: string,
  nextPrompt: string,
): boolean {
  const restored = normalizeRestoredQueuedPrompt(restoredPrompt);
  const next = normalizeRestoredQueuedPrompt(nextPrompt);
  if (next.length === 0) {
    return false;
  }
  if (restored.length === 0) {
    return true;
  }
  if (next.includes(restored)) {
    return true;
  }
  if (next.length >= Math.min(16, restored.length) && restored.includes(next)) {
    return true;
  }
  const probe = restored.slice(0, Math.min(48, restored.length));
  return probe.length >= 16 && next.includes(probe);
}
