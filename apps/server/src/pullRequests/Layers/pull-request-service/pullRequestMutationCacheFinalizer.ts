import { Effect } from "effect";

import { repositoryPullRequestIdentityKey } from "../../../pullRequests.logic";
import type { KeyedSingleFlightCache } from "../../KeyedSingleFlightCache";
import { pullRequestCacheKeyBelongsToRepository } from "./pullRequestServiceValues";

interface PullRequestMutationCaches {
  readonly itemCache: Pick<KeyedSingleFlightCache<unknown, unknown>, "invalidate">;
  readonly listCache: Pick<KeyedSingleFlightCache<unknown, unknown>, "invalidateWhere">;
  readonly reviewMatchCache: Pick<KeyedSingleFlightCache<unknown, unknown>, "invalidateWhere">;
}

export function makePullRequestMutationCacheFinalizer(caches: PullRequestMutationCaches) {
  return (
    repository: string,
    number: number,
    options: { readonly invalidateReviewMatches: boolean },
  ) =>
    Effect.uninterruptible(
      Effect.all(
        [
          caches.listCache.invalidateWhere((key) =>
            pullRequestCacheKeyBelongsToRepository(key, repository),
          ),
          ...(options.invalidateReviewMatches
            ? [
                caches.reviewMatchCache.invalidateWhere((key) =>
                  pullRequestCacheKeyBelongsToRepository(key, repository),
                ),
              ]
            : []),
          caches.itemCache.invalidate(repositoryPullRequestIdentityKey({ repository, number })),
        ],
        { concurrency: 3, discard: true },
      ),
    );
}
