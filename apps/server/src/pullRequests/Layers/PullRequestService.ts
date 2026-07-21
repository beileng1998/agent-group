import {
  type OrchestrationProject,
  type PullRequestDetail,
  type PullRequestInvolvement,
  type PullRequestListEntry,
} from "@agent-group/contracts";
import { coalescePullRequestListEntries } from "@agent-group/shared/githubRepository";
import { Effect, Layer, Scope, Semaphore } from "effect";

import { ServerConfig } from "../../config";
import type { GitHubCliError } from "../../git/Errors";
import { GitCore } from "../../git/Services/GitCore";
import { GitHubCli } from "../../git/Services/GitHubCli";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { ProjectPullRequestPins } from "../../persistence/Services/ProjectPullRequestPins";
import {
  buildPullRequestListEntry,
  isViewerReviewRequested,
  orderPullRequestListEntries,
  projectPullRequestIdentityKey,
  pullRequestListCacheKey,
  pullRequestListForceRefreshCacheKeys,
  repositoryPullRequestIdentityKey,
  shouldLoadReviewingCompanion,
} from "../../pullRequests.logic";
import { makeKeyedSingleFlightCache } from "../KeyedSingleFlightCache";
import { PullRequestService, type PullRequestServiceShape } from "../Services/PullRequestService";
import { resolveGitHubRepositories, type GitHubRepositoryInventory } from "../repositoryResolution";
import {
  cleanupUnconfiguredPullRequestPins,
  indexProjectRepositoryInventories,
  resolveProjectRepositoryInventories,
} from "../projectRepositoryInventory";
import { makePullRequestOperations } from "../pullRequestOperations";
import {
  PULL_REQUEST_REVIEW_MATCH_LIMIT,
  recoverPinnedPullRequests,
  type RecoveredPullRequest,
  type ReviewRequestedMatches,
} from "../pullRequestPinRecovery";
import { makePullRequestMutationCacheFinalizer } from "./pull-request-service/pullRequestMutationCacheFinalizer";
import { makePullRequestProjectAccess } from "./pull-request-service/pullRequestProjectAccess";
import {
  GITHUB_REPOSITORY_CACHE_MAX_ENTRIES,
  isDefinitivePullRequestNotFound,
  isGlobalGitHubCliError,
  PULL_REQUEST_LIST_CACHE_MAX_ENTRIES,
  PULL_REQUEST_MERGE_CAPABILITIES_CACHE_MAX_ENTRIES,
  PULL_REQUEST_PIN_ITEM_CACHE_MAX_ENTRIES,
  PULL_REQUEST_REVIEW_MATCH_CACHE_MAX_ENTRIES,
  type PullRequestListBatch,
  type PullRequestListError,
  type PullRequestServiceDependencies,
} from "./pull-request-service/pullRequestServiceValues";

export { PULL_REQUEST_PIN_RECOVERY_LIMIT } from "../pullRequestPinRecovery";
export {
  isDefinitivePullRequestNotFound,
  pullRequestCacheKeyBelongsToRepository,
  type PullRequestServiceDependencies,
} from "./pull-request-service/pullRequestServiceValues";

export const makePullRequestService = (
  dependencies: PullRequestServiceDependencies,
): Effect.Effect<PullRequestServiceShape, never, Scope.Scope> =>
  Effect.gen(function* () {
    // One server-wide PR service can receive overlapping all-project requests. Keep GitHub reads
    // bounded across requests and cache keys, while mutations bypass this queue so user actions do
    // not wait behind background list warming.
    const githubReadSlots = yield* Semaphore.make(6);
    const withGitHubRead = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      githubReadSlots.withPermits(1)(effect);
    const repositoryCache = yield* makeKeyedSingleFlightCache<GitHubRepositoryInventory, unknown>({
      maxEntries: GITHUB_REPOSITORY_CACHE_MAX_ENTRIES,
      ttlMs: 30_000,
    });
    const viewerCache = yield* makeKeyedSingleFlightCache<string, GitHubCliError>({
      maxEntries: 1,
      ttlMs: 5 * 60_000,
    });
    const listCache = yield* makeKeyedSingleFlightCache<PullRequestListBatch, GitHubCliError>({
      maxEntries: PULL_REQUEST_LIST_CACHE_MAX_ENTRIES,
      ttlMs: 30_000,
    });
    const itemCache = yield* makeKeyedSingleFlightCache<RecoveredPullRequest, GitHubCliError>({
      maxEntries: PULL_REQUEST_PIN_ITEM_CACHE_MAX_ENTRIES,
      ttlMs: (result) => (result._tag === "not-found" ? 30_000 : 15_000),
    });
    const reviewMatchCache = yield* makeKeyedSingleFlightCache<
      ReviewRequestedMatches,
      GitHubCliError
    >({ maxEntries: PULL_REQUEST_REVIEW_MATCH_CACHE_MAX_ENTRIES, ttlMs: 15_000 });
    const mergeCapabilitiesCache = yield* makeKeyedSingleFlightCache<
      PullRequestDetail["mergeCapabilities"],
      GitHubCliError
    >({ maxEntries: PULL_REQUEST_MERGE_CAPABILITIES_CACHE_MAX_ENTRIES, ttlMs: 5 * 60_000 });

    const pullRequestMutationCacheFinalizer = makePullRequestMutationCacheFinalizer({
      itemCache,
      listCache,
      reviewMatchCache,
    });

    const resolveProjectRepositories = (project: OrchestrationProject) =>
      repositoryCache.get(project.workspaceRoot, dependencies.resolveRepositories(project));

    const { findProject, validateProjectPullRequestRepository, validatePullRequestRepository } =
      makePullRequestProjectAccess({
        getSnapshot: dependencies.getSnapshot,
        resolveProjectRepositories,
      });

    const loadViewer = () =>
      viewerCache.get(
        "viewer",
        withGitHubRead(dependencies.github.getViewerLogin({ cwd: dependencies.homeDir })),
      );

    const loadRepositoryPullRequests = (
      cwd: string,
      repository: string,
      state: "open" | "closed" | "merged",
      involvement: PullRequestInvolvement,
      viewer: string,
    ) => {
      const cacheKey = pullRequestListCacheKey(repository, state, involvement, viewer);
      const limit = 50;
      return listCache.get(
        cacheKey,
        withGitHubRead(
          dependencies.github.listRepositoryPullRequests({
            cwd,
            repository,
            state,
            involvement,
            viewer,
            limit: limit + 1,
          }),
        ).pipe(
          Effect.map((batch) => ({
            entries: batch.entries.slice(0, limit),
            // Cardinality must be measured before tolerant decoding drops malformed entries.
            // Otherwise a raw 51-item response can look complete and strand a pin at the cap.
            truncated: batch.rawCount > limit,
          })),
        ),
      );
    };

    const loadPullRequestListItem = (cwd: string, repository: string, number: number) => {
      const key = repositoryPullRequestIdentityKey({ repository, number });
      return itemCache.get(
        key,
        withGitHubRead(
          dependencies.github.getPullRequestListItem({ cwd, repository, number }),
        ).pipe(
          Effect.map((item): RecoveredPullRequest => ({ _tag: "found", item })),
          Effect.catch((error) =>
            isDefinitivePullRequestNotFound(error)
              ? Effect.succeed<RecoveredPullRequest>({ _tag: "not-found" })
              : Effect.fail(error),
          ),
        ),
      );
    };

    const loadReviewRequestedPullRequestNumbers = (
      cwd: string,
      repository: string,
      viewer: string,
    ) => {
      const key = pullRequestListCacheKey(repository, "open", "reviewing", viewer);
      return reviewMatchCache.get(
        key,
        withGitHubRead(
          dependencies.github.listReviewRequestedPullRequestNumbers({
            cwd,
            repository,
            viewer,
            limit: PULL_REQUEST_REVIEW_MATCH_LIMIT,
          }),
        ).pipe(
          Effect.map(
            (numbers): ReviewRequestedMatches => ({
              numbers: new Set(numbers),
              incomplete: numbers.length >= PULL_REQUEST_REVIEW_MATCH_LIMIT,
            }),
          ),
        ),
      );
    };

    const loadMergeCapabilities = (cwd: string, repository: string) =>
      mergeCapabilitiesCache.get(
        repository.toLowerCase(),
        withGitHubRead(dependencies.github.getRepositoryMergeCapabilities({ cwd, repository })),
      );

    const list: PullRequestServiceShape["list"] = (input) =>
      Effect.gen(function* () {
        const forceRefresh = input.forceRefresh === true;
        const involvement = input.involvement ?? "all";
        const snapshot = yield* dependencies.getSnapshot();
        const projects = snapshot.projects.filter(
          (project) =>
            project.deletedAt === null &&
            project.kind === "project" &&
            (input.projectId == null || project.id === input.projectId),
        );
        const projectById = new Map(projects.map((project) => [project.id, project]));
        if (forceRefresh) {
          // The viewer participates in involvement filtering and list cache keys. A manual refresh
          // must observe a recent `gh auth switch/login` instead of retaining the previous account
          // until the normal five-minute viewer TTL expires.
          yield* viewerCache.invalidateAll;
          yield* Effect.forEach(
            projects,
            (project) => repositoryCache.invalidate(project.workspaceRoot),
            { concurrency: "unbounded", discard: true },
          );
        }

        const [resolved, pinnedRows] = yield* Effect.all(
          [
            resolveProjectRepositoryInventories({
              projects,
              resolve: resolveProjectRepositories,
            }),
            dependencies.pins.listByProjectIds({
              projectIds: projects.map((project) => project.id),
            }),
          ],
          { concurrency: 2 },
        );
        const pinnedKeys = new Set(
          pinnedRows.map((row) =>
            projectPullRequestIdentityKey({
              projectId: row.projectId,
              repository: row.repositoryKey,
              number: row.number,
            }),
          ),
        );

        const {
          errors: inventoryErrors,
          repositoryKeysByProject,
          uniqueRepositories,
        } = indexProjectRepositoryInventories(resolved);
        const cleanupErrors = yield* cleanupUnconfiguredPullRequestPins({
          pins: dependencies.pins,
          pinnedRows,
          projectById,
          repositoryKeysByProject,
          resolved,
        });
        const errors: PullRequestListError[] = [...inventoryErrors, ...cleanupErrors];
        if (uniqueRepositories.size === 0) {
          return { viewer: null, entries: [], errors, repositoryBatches: [] };
        }

        const viewer = yield* loadViewer();
        if (forceRefresh) {
          yield* Effect.forEach(
            uniqueRepositories.values(),
            ({ repository }) =>
              Effect.forEach(
                pullRequestListForceRefreshCacheKeys({
                  repository: repository.nameWithOwner,
                  state: input.state,
                  viewer,
                }),
                (key) => listCache.invalidate(key),
                { concurrency: "unbounded", discard: true },
              ),
            { concurrency: "unbounded", discard: true },
          );
        }

        const batches = yield* Effect.forEach(
          uniqueRepositories.values(),
          ({ projects: repositoryProjects, repository }) =>
            Effect.gen(function* () {
              const cwd = repositoryProjects[0]!.workspaceRoot;
              const [result, reviewingResult] = yield* Effect.all(
                [
                  loadRepositoryPullRequests(
                    cwd,
                    repository.nameWithOwner,
                    input.state,
                    involvement,
                    viewer,
                  ),
                  shouldLoadReviewingCompanion(input.state, involvement)
                    ? loadRepositoryPullRequests(
                        cwd,
                        repository.nameWithOwner,
                        input.state,
                        "reviewing",
                        viewer,
                      )
                    : Effect.succeed(null),
                ],
                { concurrency: 2 },
              );
              const reviewingNumbers = new Set(
                reviewingResult?.entries.map((pullRequest) => pullRequest.number) ?? [],
              );
              return {
                entries: repositoryProjects.flatMap((project) =>
                  result.entries.map(
                    (pullRequest): PullRequestListEntry =>
                      buildPullRequestListEntry({
                        project,
                        repository: repository.nameWithOwner,
                        pullRequest,
                        viewerReviewRequested: isViewerReviewRequested(
                          pullRequest.author,
                          pullRequest.reviewRequestLogins,
                          viewer,
                          involvement === "reviewing" || reviewingNumbers.has(pullRequest.number),
                        ),
                        isPinned: pinnedKeys.has(
                          projectPullRequestIdentityKey({
                            projectId: project.id,
                            repository: repository.nameWithOwner,
                            number: pullRequest.number,
                          }),
                        ),
                      }),
                  ),
                ),
                // The list cap belongs to the remote repository. Reporting one batch per local
                // worktree made the all-projects UI overcount truncated repositories.
                repositoryBatches: repositoryProjects.slice(0, 1).map((project) => ({
                  projectId: project.id,
                  projectTitle: project.title,
                  repository: repository.nameWithOwner,
                  truncated: result.truncated,
                })),
                errors: [] as PullRequestListError[],
                recovery: {
                  cwd,
                  repository: repository.nameWithOwner,
                  projects: repositoryProjects,
                  truncated: result.truncated,
                  reviewingNumbers,
                  reviewingTruncated: reviewingResult?.truncated === true,
                },
              };
            }).pipe(
              Effect.catch((error) =>
                isGlobalGitHubCliError(error)
                  ? Effect.fail(error)
                  : Effect.succeed({
                      entries: [] as PullRequestListEntry[],
                      repositoryBatches: [],
                      errors: repositoryProjects.map((project) => ({
                        projectId: project.id,
                        projectTitle: project.title,
                        message: error.message,
                      })),
                      recovery: null,
                    }),
              ),
            ),
          { concurrency: 6 },
        );
        const batchEntries = batches.flatMap((batch) => batch.entries);
        const recovery = yield* recoverPinnedPullRequests({
          state: input.state,
          involvement,
          viewer,
          forceRefresh,
          pins: pinnedRows,
          pinStore: dependencies.pins,
          batchEntries,
          recoveryContexts: batches.flatMap((batch) => (batch.recovery ? [batch.recovery] : [])),
          repositoryKeysByProject,
          projectById,
          isGlobalError: isGlobalGitHubCliError,
          invalidateReviewMatches: (repository, viewerLogin) =>
            reviewMatchCache.invalidate(
              pullRequestListCacheKey(repository, "open", "reviewing", viewerLogin),
            ),
          loadReviewMatches: loadReviewRequestedPullRequestNumbers,
          invalidateItem: (key) => itemCache.invalidate(key),
          loadItem: loadPullRequestListItem,
        });

        const visibleEntries = coalescePullRequestListEntries([
          ...batchEntries,
          ...recovery.entries,
        ]);
        return {
          viewer,
          entries: orderPullRequestListEntries(visibleEntries),
          errors: [...errors, ...batches.flatMap((batch) => batch.errors), ...recovery.errors],
          repositoryBatches: batches.flatMap((batch) => batch.repositoryBatches),
        };
      });

    const reviewRequestCount: PullRequestServiceShape["reviewRequestCount"] = (input) =>
      Effect.gen(function* () {
        const snapshot = yield* dependencies.getSnapshot();
        const projects = snapshot.projects.filter(
          (project) =>
            project.deletedAt === null &&
            project.kind === "project" &&
            (input.projectId == null || project.id === input.projectId),
        );
        const resolved = yield* resolveProjectRepositoryInventories({
          projects,
          resolve: resolveProjectRepositories,
        });
        const { uniqueRepositories } = indexProjectRepositoryInventories(resolved);
        const inventoryIncomplete = resolved.some(
          (item) => item.error !== null || !item.inventory.authoritative,
        );
        if (uniqueRepositories.size === 0) {
          return { count: 0, incomplete: inventoryIncomplete };
        }

        const viewer = yield* loadViewer();
        const repositoryCounts = yield* Effect.forEach(
          uniqueRepositories.values(),
          ({ projects: repositoryProjects, repository }) =>
            loadReviewRequestedPullRequestNumbers(
              repositoryProjects[0]!.workspaceRoot,
              repository.nameWithOwner,
              viewer,
            ).pipe(
              Effect.map((matches) => ({
                count: matches.numbers.size,
                incomplete: matches.incomplete,
              })),
              Effect.catch((error) =>
                isGlobalGitHubCliError(error)
                  ? Effect.fail(error)
                  : Effect.succeed({ count: 0, incomplete: true }),
              ),
            ),
          { concurrency: 6 },
        );

        return {
          count: repositoryCounts.reduce((total, result) => total + result.count, 0),
          incomplete: inventoryIncomplete || repositoryCounts.some((result) => result.incomplete),
        };
      });

    const operations = makePullRequestOperations({
      github: dependencies.github,
      pins: dependencies.pins,
      findProject,
      validateRepository: validatePullRequestRepository,
      validateProjectRepository: validateProjectPullRequestRepository,
      loadMergeCapabilities,
      withGitHubRead,
      finalizeMutationCaches: pullRequestMutationCacheFinalizer,
    });

    return {
      list,
      reviewRequestCount,
      ...operations,
    } satisfies PullRequestServiceShape;
  });

export const PullRequestServiceLive = Layer.effect(
  PullRequestService,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const git = yield* GitCore;
    const github = yield* GitHubCli;
    const pins = yield* ProjectPullRequestPins;
    const projection = yield* ProjectionSnapshotQuery;
    return yield* makePullRequestService({
      homeDir: config.homeDir,
      github,
      pins,
      getSnapshot: () => projection.getSnapshot(),
      resolveRepositories: (project) => resolveGitHubRepositories(git, project.workspaceRoot),
    });
  }),
);
