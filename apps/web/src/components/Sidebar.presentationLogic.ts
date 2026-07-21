// Sidebar presentation and navigation helpers.

import type { PullRequestReviewRequestCountResult, ThreadId } from "@agent-group/contracts";
import { pluralize } from "@agent-group/shared/text";
import { resolveThreadEnvironmentMode } from "@agent-group/shared/threadEnvironment";
import type { SidebarThreadSummary, Project } from "../types";
import { resolveRestorableThreadRoute, type LastThreadRoute } from "../chatRouteRestore";
import { cn } from "../lib/utils";
import {
  SIDEBAR_ROW_ACTIVE_CLASS_NAME,
  SIDEBAR_ROW_HOVER_CLASS_NAME,
  SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
  SIDEBAR_THREAD_ROW_BASE_CLASS_NAME,
} from "../sidebarRowStyles";
import { formatWorktreePathForDisplay } from "../worktreeCleanup";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";
export const SIDEBAR_THREAD_PREWARM_LIMIT = 10;
export const DEBUG_FEATURE_FLAGS_MENU_STORAGE_KEY = "agent-group:show-debug-feature-flags-menu";
export type SidebarNewThreadEnvMode = "local" | "worktree";
export type SidebarView = "threads" | "studio" | "workspace";
export type SidebarActionBadge = {
  readonly text: string;
  readonly accessibleLabel: string;
};

/** Keep partial review counts visible without presenting them as exact. */
export function resolvePullRequestReviewBadge(
  result: PullRequestReviewRequestCountResult | undefined,
): SidebarActionBadge | null {
  if (!result) return null;
  if (result.incomplete) {
    return result.count > 0
      ? {
          text: `${result.count}+`,
          accessibleLabel: `At least ${result.count} ${pluralize(
            result.count,
            "pull request is",
            "pull requests are",
          )} waiting for your review`,
        }
      : {
          text: "?",
          accessibleLabel: "The pull request review count is temporarily incomplete",
        };
  }
  return result.count > 0
    ? {
        text: String(result.count),
        accessibleLabel: `${result.count} ${pluralize(
          result.count,
          "pull request is",
          "pull requests are",
        )} waiting for your review`,
      }
    : null;
}

/** Stable repository-resolution input for PR caches. Sidebar-only presentation changes such as
 * expand/collapse and ordering do not invalidate; project roots/names do. */
export function pullRequestRepositoryConfigFingerprint(
  projects: ReadonlyArray<Pick<Project, "id" | "kind" | "cwd" | "name" | "remoteName">>,
): string {
  return JSON.stringify(
    projects
      .filter((project) => project.kind === "project")
      .map((project) => [project.id, project.cwd, project.name, project.remoteName] as const)
      .toSorted((left, right) => left[0].localeCompare(right[0])),
  );
}

/** The optimistic segment follows a destination click and clears when the user returns. */
export function resolvePendingSidebarViewSelection(
  activeView: SidebarView,
  selectedView: SidebarView,
): SidebarView | null {
  return selectedView === activeView ? null : selectedView;
}

function nonEmptyDisplayValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function differentDisplayValue(
  value: string | null | undefined,
  existing: string | null,
): string | null {
  const normalized = nonEmptyDisplayValue(value);
  if (!normalized) {
    return null;
  }
  return existing !== null && normalized === existing ? null : normalized;
}

export type SidebarThreadHoverMetadata = {
  projectName: string | null;
  projectCwd: string | null;
  sourceProjectName: string | null;
  branch: string | null;
  worktreeName: string | null;
};

export function resolveThreadHoverCardMetadata(input: {
  thread: Pick<
    SidebarThreadSummary,
    "envMode" | "branch" | "worktreePath" | "associatedWorktreePath" | "associatedWorktreeBranch"
  >;
  project: Pick<Project, "name" | "folderName" | "cwd"> | null;
}): SidebarThreadHoverMetadata {
  const projectName =
    nonEmptyDisplayValue(input.project?.name) ?? nonEmptyDisplayValue(input.project?.folderName);
  const activeWorktreePath = nonEmptyDisplayValue(input.thread.worktreePath);
  const isWorktree =
    resolveThreadEnvironmentMode({
      envMode: input.thread.envMode,
      worktreePath: activeWorktreePath,
    }) === "worktree";
  const associatedWorktreePath = nonEmptyDisplayValue(input.thread.associatedWorktreePath);
  const worktreePath = isWorktree ? (associatedWorktreePath ?? activeWorktreePath) : null;

  return {
    projectName,
    projectCwd: input.project?.cwd ?? null,
    sourceProjectName: isWorktree
      ? differentDisplayValue(input.project?.folderName, projectName)
      : null,
    branch:
      nonEmptyDisplayValue(input.thread.associatedWorktreeBranch) ??
      nonEmptyDisplayValue(input.thread.branch),
    worktreeName: worktreePath ? formatWorktreePathForDisplay(worktreePath) : null,
  };
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase().replace(/\.$/, "");

  return (
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "::1" ||
    normalizedHostname === "[::1]"
  );
}

export function shouldShowDebugFeatureFlagsMenu(input: {
  readonly isDev: boolean;
  readonly hostname: string;
  readonly storageValue: string | null;
}): boolean {
  return input.isDev && isLoopbackHostname(input.hostname) && input.storageValue === "true";
}

export type SidebarThreadHoverAnchorScope = "pinned" | "chat" | "project";

export function createSidebarThreadHoverAnchorId(input: {
  scope: SidebarThreadHoverAnchorScope;
  threadId: ThreadId;
}): string {
  return `${input.scope}:${input.threadId}`;
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

export function resolveSidebarNewThreadEnvMode(input: {
  requestedEnvMode?: SidebarNewThreadEnvMode;
  defaultEnvMode: SidebarNewThreadEnvMode;
}): SidebarNewThreadEnvMode {
  return input.requestedEnvMode ?? input.defaultEnvMode;
}

export type SettingsBackTarget =
  | {
      kind: "thread";
      threadId: string;
      splitViewId?: string | undefined;
    }
  | {
      kind: "home";
    };

export function resolveSettingsBackTarget(input: {
  lastThreadRoute: LastThreadRoute | null;
  availableThreadIds: ReadonlySet<string>;
  latestThreadId: string | null;
  availableSplitViewIds?: ReadonlySet<string>;
}): SettingsBackTarget {
  const restorableRoute = resolveRestorableThreadRoute({
    lastThreadRoute: input.lastThreadRoute,
    availableThreadIds: input.availableThreadIds,
    ...(input.availableSplitViewIds ? { availableSplitViewIds: input.availableSplitViewIds } : {}),
  });

  if (restorableRoute) {
    return {
      kind: "thread",
      threadId: restorableRoute.threadId,
      splitViewId: restorableRoute.splitViewId,
    };
  }

  if (input.latestThreadId) {
    return {
      kind: "thread",
      threadId: input.latestThreadId,
    };
  }

  return { kind: "home" };
}

/**
 * Trailing padding that protects the title from the absolutely-positioned
 * trailing cluster, sized to what the slot ACTUALLY shows so the title runs as
 * far right as the on-screen content allows:
 *
 * - The relative time now lives in the row hover card, so an idle row with no
 *   status/jump glyph and no meta chips reserves almost nothing — the title runs
 *   to the row edge instead of truncating against permanently reserved space.
 * - A status/loader (or keyboard-jump) glyph occupies a ~2.25rem slot, and each
 *   fork/worktree/handoff meta chip adds width; the reserve grows only for the
 *   badges that are present.
 * - The wider reserve that clears the hover pin/archive actions is applied only
 *   on hover/focus (mirroring the project header row), so the title gives up that
 *   width exactly when those actions appear and not a moment sooner.
 *
 * Literal class strings are required so Tailwind's JIT scanner emits them.
 */
export function resolveThreadRowTrailingReserveClass(input: {
  metaChipCount: number;
  hasTrailingGlyph: boolean;
}): string {
  // Hover/focus reveals the pin/archive actions; the meta chips + glyph fade out
  // at the same time, so the hover reserve is constant regardless of rest content.
  const hoverReserve =
    "transition-[padding] duration-150 ease-out group-hover/thread-row:pr-[4.75rem] group-focus-within/thread-row:pr-[4.75rem]";
  const { metaChipCount, hasTrailingGlyph } = input;
  if (metaChipCount <= 0) {
    return cn(hasTrailingGlyph ? "pr-[1.75rem]" : "pr-2", hoverReserve);
  }
  if (metaChipCount === 1) {
    return cn(hasTrailingGlyph ? "pr-[3rem]" : "pr-[1.75rem]", hoverReserve);
  }
  if (metaChipCount === 2) {
    return cn(hasTrailingGlyph ? "pr-[4rem]" : "pr-[3rem]", hoverReserve);
  }
  return cn(hasTrailingGlyph ? "pr-[4.5rem]" : "pr-[4.25rem]", hoverReserve);
}

export function resolveThreadRowClassName(input: {
  isActive: boolean;
  isSelected: boolean;
}): string {
  // Trailing reserve for the absolute cluster is applied separately by callers
  // via resolveThreadRowTrailingReserveClass so it can flex with the chip count.
  const baseClassName = SIDEBAR_THREAD_ROW_BASE_CLASS_NAME;

  if (input.isSelected && input.isActive) {
    return cn(baseClassName, SIDEBAR_ROW_ACTIVE_CLASS_NAME);
  }

  if (input.isSelected) {
    return cn(baseClassName, SIDEBAR_ROW_ACTIVE_CLASS_NAME);
  }

  if (input.isActive) {
    return cn(baseClassName, SIDEBAR_ROW_ACTIVE_CLASS_NAME);
  }

  return cn(baseClassName, SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME, SIDEBAR_ROW_HOVER_CLASS_NAME);
}
