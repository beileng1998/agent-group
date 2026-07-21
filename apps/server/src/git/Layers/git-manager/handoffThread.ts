import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { resolveWorktreeHandoffIntent } from "@agent-group/shared/worktreeHandoff";
import { GitManagerError } from "../../Errors.ts";
import type { GitManagerShape } from "../../Services/GitManager.ts";
import type { GitCoreShape } from "../../Services/GitCore.ts";
import {
  buildFailedLocalHandoffRecoveryDetail,
  buildFailedLocalTransferDetail,
  buildFailedWorktreeHandoffRecoveryDetail,
  buildFailedWorktreeTransferDetail,
  gitManagerError,
} from "./gitManagerErrors.ts";
import type { makeHandoffRuntime } from "./handoffRuntime.ts";

export function makeHandoffThread(deps: {
  gitCore: GitCoreShape;
  runtime: ReturnType<typeof makeHandoffRuntime>;
}) {
  const { gitCore } = deps;
  const {
    readHeadRef,
    checkoutDetached,
    createDetachedWorktree,
    createNamedWorktree,
    stashWorkingTree,
    popStash,
    restoreSourceStash,
    restoreStashes,
    resolveForegroundFallbackBranch,
    restoreLocalHandoffSource,
    restoreRemovedWorktreeAfterFailedLocalCheckout,
    rollbackFailedLocalTransfer,
    rollbackFailedWorktreeTransfer,
  } = deps.runtime;
  const handoffThread: GitManagerShape["handoffThread"] = Effect.fnUntraced(function* (input) {
    const currentLocalStatus = yield* gitCore.statusDetails(input.cwd);

    if (input.targetMode === "local") {
      if (!input.worktreePath) {
        return yield* gitManagerError(
          "handoffThread",
          "Cannot hand off to Local because this thread does not have a materialized worktree.",
        );
      }

      const worktreeHeadRef = yield* readHeadRef(input.worktreePath);
      const targetLocalBranch =
        input.currentBranch ?? input.associatedWorktreeBranch ?? input.preferredLocalBranch ?? null;
      if (!(targetLocalBranch ?? worktreeHeadRef)) {
        return yield* gitManagerError(
          "handoffThread",
          "Cannot hand off to Local because the worktree thread does not have a recoverable HEAD reference.",
        );
      }

      const associatedWorktreePath = input.associatedWorktreePath ?? input.worktreePath;
      const associatedWorktreeBranch =
        input.associatedWorktreeBranch ?? input.currentBranch ?? null;
      const associatedWorktreeRef =
        input.associatedWorktreeRef ?? worktreeHeadRef ?? associatedWorktreeBranch;
      const originalLocalBranch = currentLocalStatus.branch ?? null;
      const originalLocalHeadRef = yield* readHeadRef(input.cwd);
      let currentLocalBranchAfterPreparation = originalLocalBranch;

      const preservedLocalStash = yield* stashWorkingTree(
        input.cwd,
        `agent-group preserve local handoff ${randomUUID()}`,
      );
      const sourceStash = yield* stashWorkingTree(
        input.worktreePath,
        `agent-group handoff to local ${randomUUID()}`,
      );

      yield* gitCore
        .removeWorktree({
          cwd: input.cwd,
          path: input.worktreePath,
        })
        .pipe(
          Effect.catch((error) =>
            restoreStashes([
              { cwd: input.worktreePath!, stashRef: sourceStash.stashRef },
              { cwd: input.cwd, stashRef: preservedLocalStash.stashRef },
            ]).pipe(Effect.flatMap(() => Effect.fail(error))),
          ),
        );

      if (targetLocalBranch && currentLocalStatus.branch !== targetLocalBranch) {
        yield* Effect.scoped(
          gitCore.checkoutBranch({
            cwd: input.cwd,
            branch: targetLocalBranch,
          }),
        ).pipe(
          Effect.catch((error) =>
            restoreRemovedWorktreeAfterFailedLocalCheckout({
              cwd: input.cwd,
              worktreePath: associatedWorktreePath,
              branch: associatedWorktreeBranch,
              ref: associatedWorktreeRef,
              worktreeStashRef: sourceStash.stashRef,
              localStashRef: preservedLocalStash.stashRef,
            }).pipe(
              Effect.flatMap((recovery) =>
                Effect.fail(
                  new GitManagerError({
                    operation: "GitManager.handoffThread",
                    detail: buildFailedLocalHandoffRecoveryDetail(error.message, recovery),
                    cause: error,
                  }),
                ),
              ),
            ),
          ),
        );
        currentLocalBranchAfterPreparation = targetLocalBranch;
      } else if (!targetLocalBranch && worktreeHeadRef) {
        yield* checkoutDetached(input.cwd, worktreeHeadRef).pipe(
          Effect.catch((error) =>
            restoreRemovedWorktreeAfterFailedLocalCheckout({
              cwd: input.cwd,
              worktreePath: associatedWorktreePath,
              branch: associatedWorktreeBranch,
              ref: associatedWorktreeRef,
              worktreeStashRef: sourceStash.stashRef,
              localStashRef: preservedLocalStash.stashRef,
            }).pipe(
              Effect.flatMap((recovery) =>
                Effect.fail(
                  new GitManagerError({
                    operation: "GitManager.handoffThread",
                    detail: buildFailedLocalHandoffRecoveryDetail(error.message, recovery),
                    cause: error,
                  }),
                ),
              ),
            ),
          ),
        );
        currentLocalBranchAfterPreparation = null;
      }

      const threadTransfer = yield* popStash(input.cwd, sourceStash.stashRef);
      if (threadTransfer.conflictsDetected) {
        const recovery = yield* rollbackFailedLocalTransfer({
          cwd: input.cwd,
          originalBranch: originalLocalBranch,
          originalHeadRef: originalLocalHeadRef,
          currentBranch: currentLocalBranchAfterPreparation,
          worktreePath: associatedWorktreePath,
          worktreeBranch: associatedWorktreeBranch,
          worktreeRef: associatedWorktreeRef,
          worktreeStashRef: sourceStash.stashRef,
          localStashRef: preservedLocalStash.stashRef,
        });
        return yield* new GitManagerError({
          operation: "GitManager.handoffThread",
          detail: buildFailedLocalTransferDetail(
            `${
              threadTransfer.message ??
              "Git reported conflicts while applying the handed off changes."
            } The handoff was rolled back so the thread stays in its worktree.`,
            recovery,
          ),
        });
      }

      const localTransfer = yield* popStash(input.cwd, preservedLocalStash.stashRef);
      const changesTransferred = sourceStash.hadChanges || preservedLocalStash.hadChanges;
      const movedThreadChanges = sourceStash.hadChanges;
      const restoredLocalChanges = preservedLocalStash.hadChanges;
      const localTargetLabel = targetLocalBranch
        ? `main local checkout on '${targetLocalBranch}'`
        : "local checkout in detached HEAD";
      const message = localTransfer.conflictsDetected
        ? `${
            localTransfer.message ??
            "Git reported conflicts while restoring your previous local changes."
          }\nYour previous local stash entry was kept for recovery.`
        : movedThreadChanges && restoredLocalChanges
          ? `Moved the thread back to the ${localTargetLabel}, carried its uncommitted work over, and restored your previous local changes.`
          : movedThreadChanges
            ? `Moved the thread back to the ${localTargetLabel} and carried its uncommitted work over.`
            : restoredLocalChanges
              ? `Moved the thread back to the ${localTargetLabel} and restored your previous local changes.`
              : `Moved the thread back to the ${localTargetLabel}.`;

      return {
        targetMode: "local",
        branch: targetLocalBranch,
        worktreePath: null,
        associatedWorktreePath,
        associatedWorktreeBranch,
        associatedWorktreeRef,
        changesTransferred,
        conflictsDetected: localTransfer.conflictsDetected,
        message,
      };
    }

    const worktreeIntent = resolveWorktreeHandoffIntent({
      preferredNewWorktreeName: input.preferredNewWorktreeName,
      associatedWorktreePath: input.associatedWorktreePath,
      associatedWorktreeBranch: input.associatedWorktreeBranch,
      associatedWorktreeRef: input.associatedWorktreeRef,
      preferredWorktreeBaseBranch:
        input.preferredWorktreeBaseBranch ?? currentLocalStatus.branch ?? null,
      currentBranch: input.currentBranch,
    });
    if (!worktreeIntent) {
      return yield* gitManagerError(
        "handoffThread",
        "Cannot hand off to a worktree because no worktree target is available.",
      );
    }
    const targetWorktreeName =
      worktreeIntent.kind === "create-new" ? worktreeIntent.worktreeName : null;
    const targetAssociatedWorktreePath =
      worktreeIntent.kind === "reuse-associated" ? worktreeIntent.associatedWorktreePath : null;
    const targetAssociatedWorktreeBranch =
      worktreeIntent.kind === "reuse-associated" ? worktreeIntent.associatedWorktreeBranch : null;
    const targetAssociatedWorktreeRef =
      worktreeIntent.kind === "reuse-associated" ? worktreeIntent.associatedWorktreeRef : null;
    const targetBaseBranch = worktreeIntent.baseBranch;
    if (!targetBaseBranch && !targetAssociatedWorktreeBranch && !targetAssociatedWorktreeRef) {
      return yield* gitManagerError(
        "handoffThread",
        "Select a base branch before handing off this thread to a worktree.",
      );
    }

    const sourceStash = yield* stashWorkingTree(
      input.cwd,
      `agent-group handoff to worktree ${randomUUID()}`,
    );
    const sourceBranch = currentLocalStatus.branch ?? input.currentBranch ?? null;
    const sourceHeadRef = yield* readHeadRef(input.cwd);
    let foregroundBranchAfterHandoff = currentLocalStatus.branch;

    if (sourceBranch && sourceBranch === targetAssociatedWorktreeBranch) {
      const fallbackLocalBranch = yield* resolveForegroundFallbackBranch(
        input.cwd,
        targetAssociatedWorktreeBranch,
      );
      if (!fallbackLocalBranch) {
        if (!sourceHeadRef) {
          yield* restoreSourceStash(input.cwd, sourceStash.stashRef);
          return yield* gitManagerError(
            "handoffThread",
            `Cannot hand off '${targetAssociatedWorktreeBranch}' to a worktree because there is no recoverable local HEAD reference available.`,
          );
        }
        yield* checkoutDetached(input.cwd, sourceHeadRef).pipe(
          Effect.catch((error) =>
            restoreSourceStash(input.cwd, sourceStash.stashRef).pipe(
              Effect.flatMap(() => Effect.fail(error)),
            ),
          ),
        );
        foregroundBranchAfterHandoff = null;
      } else {
        yield* Effect.scoped(
          gitCore.checkoutBranch({
            cwd: input.cwd,
            branch: fallbackLocalBranch,
          }),
        ).pipe(
          Effect.catch((error) =>
            restoreSourceStash(input.cwd, sourceStash.stashRef).pipe(
              Effect.flatMap(() => Effect.fail(error)),
            ),
          ),
        );
        foregroundBranchAfterHandoff = fallbackLocalBranch;
      }
    }

    const worktree = yield* Effect.gen(function* () {
      if (targetAssociatedWorktreeRef && !targetAssociatedWorktreeBranch) {
        return yield* createDetachedWorktree({
          cwd: input.cwd,
          ref: targetAssociatedWorktreeRef,
          path: targetAssociatedWorktreePath,
        });
      }
      if (targetWorktreeName) {
        if (!targetBaseBranch) {
          return yield* gitManagerError(
            "handoffThread",
            "Select a base branch before creating a new worktree.",
          );
        }
        return yield* createNamedWorktree({
          cwd: input.cwd,
          baseBranch: targetBaseBranch,
          name: targetWorktreeName,
          path: null,
        });
      }
      if (targetAssociatedWorktreeBranch) {
        if (
          (yield* gitCore.listLocalBranchNames(input.cwd)).includes(targetAssociatedWorktreeBranch)
        ) {
          return yield* gitCore.createWorktree({
            cwd: input.cwd,
            branch: targetAssociatedWorktreeBranch,
            path: targetAssociatedWorktreePath,
          });
        }
        if (!targetBaseBranch) {
          return yield* createDetachedWorktree({
            cwd: input.cwd,
            ref: targetAssociatedWorktreeBranch,
            path: targetAssociatedWorktreePath,
          });
        }
        return yield* gitCore.createWorktree({
          cwd: input.cwd,
          branch: targetBaseBranch ?? targetAssociatedWorktreeBranch,
          newBranch: targetAssociatedWorktreeBranch,
          path: targetAssociatedWorktreePath,
        });
      }
      if (!targetBaseBranch) {
        return yield* createDetachedWorktree({
          cwd: input.cwd,
          ref: targetAssociatedWorktreeRef!,
          path: targetAssociatedWorktreePath,
        });
      }
      return yield* createDetachedWorktree({
        cwd: input.cwd,
        ref: targetBaseBranch,
        path: targetAssociatedWorktreePath,
        ...(targetWorktreeName ? { name: targetWorktreeName } : {}),
      });
    }).pipe(
      Effect.catch((error) =>
        restoreLocalHandoffSource({
          cwd: input.cwd,
          originalBranch: sourceBranch,
          originalHeadRef: sourceHeadRef,
          currentBranch: foregroundBranchAfterHandoff,
          stashRef: sourceStash.stashRef,
        }).pipe(
          Effect.flatMap((recovery) =>
            Effect.fail(
              new GitManagerError({
                operation: "GitManager.handoffThread",
                detail: buildFailedWorktreeHandoffRecoveryDetail(error.message, recovery),
                cause: error,
              }),
            ),
          ),
        ),
      ),
    );

    const transfer = yield* popStash(worktree.worktree.path, sourceStash.stashRef);
    if (transfer.conflictsDetected) {
      const recovery = yield* rollbackFailedWorktreeTransfer({
        cwd: input.cwd,
        worktreePath: worktree.worktree.path,
        originalBranch: sourceBranch,
        originalHeadRef: sourceHeadRef,
        currentBranch: foregroundBranchAfterHandoff,
        stashRef: sourceStash.stashRef,
      });
      return yield* new GitManagerError({
        operation: "GitManager.handoffThread",
        detail: buildFailedWorktreeTransferDetail(
          `${
            transfer.message ?? "Git reported conflicts while applying the handed off changes."
          } The stash entry was kept for recovery.`,
          recovery,
        ),
      });
    }

    const materializedWorktreeStatus = yield* gitCore.statusDetails(worktree.worktree.path);
    const materializedWorktreeRef =
      (yield* readHeadRef(worktree.worktree.path)) ??
      ("ref" in worktree.worktree ? worktree.worktree.ref : worktree.worktree.branch);
    const materializedWorktreeBranch = materializedWorktreeStatus.branch ?? null;
    if (materializedWorktreeBranch) {
      // Publishing is best-effort: handoff should still succeed for local-only repositories.
      yield* gitCore
        .publishBranch({ cwd: worktree.worktree.path, branch: materializedWorktreeBranch })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("GitManager.handoffThread could not publish worktree branch", {
              cwd: worktree.worktree.path,
              branch: materializedWorktreeBranch,
              reason: error.message,
            }),
          ),
        );
    }
    const changesTransferred = sourceStash.hadChanges;
    const handoffSummary =
      foregroundBranchAfterHandoff && foregroundBranchAfterHandoff !== sourceBranch
        ? `The thread moved into its worktree and Local returned to '${foregroundBranchAfterHandoff}'.`
        : foregroundBranchAfterHandoff === null && sourceBranch === targetAssociatedWorktreeBranch
          ? "The thread moved into its worktree and Local returned to a detached HEAD."
          : "The thread moved into its worktree.";
    const message = changesTransferred
      ? `${handoffSummary} Uncommitted local changes were carried over.`
      : handoffSummary;

    return {
      targetMode: "worktree",
      branch: materializedWorktreeBranch,
      worktreePath: worktree.worktree.path,
      associatedWorktreePath: worktree.worktree.path,
      associatedWorktreeBranch: materializedWorktreeBranch,
      associatedWorktreeRef: materializedWorktreeRef,
      changesTransferred,
      conflictsDetected: false,
      message,
    };
  });

  return handoffThread;
}
