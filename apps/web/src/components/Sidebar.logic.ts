// FILE: Sidebar.logic.ts
// Purpose: Compatibility facade for sidebar domain logic.
// Exports: Existing sidebar helpers and types, delegated to focused semantic modules.

export {
  extractDuplicateProjectCreateProjectId,
  isDuplicateProjectCreateError,
} from "../lib/projectCreateRecovery";

export {
  DEBUG_FEATURE_FLAGS_MENU_STORAGE_KEY,
  SIDEBAR_THREAD_PREWARM_LIMIT,
  THREAD_SELECTION_SAFE_SELECTOR,
  createSidebarThreadHoverAnchorId,
  isLoopbackHostname,
  pullRequestRepositoryConfigFingerprint,
  resolvePendingSidebarViewSelection,
  resolvePullRequestReviewBadge,
  resolveSettingsBackTarget,
  resolveSidebarNewThreadEnvMode,
  resolveThreadHoverCardMetadata,
  resolveThreadRowClassName,
  resolveThreadRowTrailingReserveClass,
  shouldClearThreadSelectionOnMouseDown,
  shouldShowDebugFeatureFlagsMenu,
} from "./Sidebar.presentationLogic";
export type {
  SettingsBackTarget,
  SidebarActionBadge,
  SidebarNewThreadEnvMode,
  SidebarThreadHoverAnchorScope,
  SidebarThreadHoverMetadata,
  SidebarView,
} from "./Sidebar.presentationLogic";

export {
  hasUnseenCompletion,
  resolveProjectStatusIndicator,
  resolveThreadStatusPill,
} from "./Sidebar.statusLogic";
export type { ThreadStatusPill } from "./Sidebar.statusLogic";

export {
  describeAddProjectError,
  findDeepestWorkspaceRootMatch,
  findWorkspaceRootMatch,
  recoverExistingAddProjectTarget,
} from "./Sidebar.projectRecoveryLogic";

export {
  buildProjectThreadTree,
  getVisibleSidebarEntriesForPreview,
  getVisibleThreadsForProject,
  pruneProjectThreadListPagingForCollapsedProjects,
  resolveSidebarThreadListPaging,
} from "./Sidebar.treeLogic";
export type { SidebarThreadListPaging, SidebarThreadTreeRow } from "./Sidebar.treeLogic";

export {
  derivePinnedProjectIdsForSidebar,
  derivePinnedThreadIdsForSidebar,
  getPinnedThreadsForSidebar,
  getUnpinnedThreadsForSidebar,
  isLatestPinnedProjectMutation,
  isLatestPinnedThreadMutation,
  orderPinnedProjectsForSidebar,
  shouldPrunePinnedThreads,
} from "./Sidebar.pinningLogic";

export {
  getNextVisibleSidebarThreadId,
  getRenderedThreadsForSidebarProject,
  getSidebarThreadIdForJumpCommand,
  getSidebarThreadIdsToPrewarm,
  getVisibleSidebarThreadIds,
  resolveProjectEmptyState,
} from "./Sidebar.visibilityLogic";
export type { ProjectEmptyState } from "./Sidebar.visibilityLogic";

export {
  getFallbackThreadIdAfterDelete,
  getProjectSortTimestamp,
  sortProjectsForSidebar,
  sortThreadsForSidebar,
} from "./Sidebar.sortingLogic";

export {
  deriveSidebarProjectData,
  groupSidebarThreadsByProjectId,
  partitionSidebarThreadsByProjectIds,
} from "./Sidebar.projectDerivationLogic";
export type {
  SidebarDerivedProjectData,
  SidebarProjectEntry,
} from "./Sidebar.projectDerivationLogic";
