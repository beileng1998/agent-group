import type { OrchestrationProject, OrchestrationReadModel, ProjectId } from "@agent-group/contracts";
import { Effect } from "effect";

import { isValidGitHubRepositoryNameWithOwner } from "../../../pullRequests.logic";
import type { GitHubRepositoryInventory } from "../../repositoryResolution";

interface PullRequestProjectAccessDependencies {
  readonly getSnapshot: () => Effect.Effect<OrchestrationReadModel, unknown>;
  readonly resolveProjectRepositories: (
    project: OrchestrationProject,
  ) => Effect.Effect<GitHubRepositoryInventory, unknown>;
}

export function makePullRequestProjectAccess(dependencies: PullRequestProjectAccessDependencies) {
  const findProject = (projectId: ProjectId) =>
    dependencies.getSnapshot().pipe(
      Effect.flatMap((snapshot) => {
        const project = snapshot.projects.find(
          (candidate) =>
            candidate.id === projectId &&
            candidate.kind === "project" &&
            candidate.deletedAt === null,
        );
        return project ? Effect.succeed(project) : Effect.fail(new Error("Project not found."));
      }),
    );

  const validatePullRequestRepository = (repository: string) => {
    const normalized = repository.trim();
    return isValidGitHubRepositoryNameWithOwner(normalized)
      ? Effect.succeed(normalized)
      : Effect.fail(new Error("Invalid GitHub repository identity."));
  };

  const validateProjectPullRequestRepository = (
    project: OrchestrationProject,
    repositoryInput: string,
  ) =>
    Effect.gen(function* () {
      const repository = yield* validatePullRequestRepository(repositoryInput);
      const inventory = yield* dependencies.resolveProjectRepositories(project);
      if (!inventory.authoritative) {
        return yield* Effect.fail(new Error("GitHub repository inventory is unavailable."));
      }
      const matched = inventory.repositories.find(
        (candidate) => candidate.nameWithOwner.toLowerCase() === repository.toLowerCase(),
      );
      if (!matched) {
        return yield* Effect.fail(
          new Error("GitHub repository does not belong to the selected project."),
        );
      }
      return matched.nameWithOwner;
    });

  return {
    findProject,
    validateProjectPullRequestRepository,
    validatePullRequestRepository,
  };
}
