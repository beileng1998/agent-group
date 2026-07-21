import { Effect, FileSystem, Layer, Path } from "effect";

import { GitManager, type GitManagerShape } from "../Services/GitManager.ts";
import { GitCore } from "../Services/GitCore.ts";
import { GitHubCli } from "../Services/GitHubCli.ts";
import { TextGeneration } from "../Services/TextGeneration.ts";
import { ServerConfig } from "../../config.ts";
import { makeCommitOperations } from "./git-manager/commitOperations.ts";
import { makeGitReadOperations } from "./git-manager/gitReadOperations.ts";
import { makeHandoffRuntime } from "./git-manager/handoffRuntime.ts";
import { makeHandoffThread } from "./git-manager/handoffThread.ts";
import { makePullRequestCreation } from "./git-manager/pullRequestCreation.ts";
import { makePullRequestHeadOperations } from "./git-manager/pullRequestHeadOperations.ts";
import { makePullRequestLookup } from "./git-manager/pullRequestLookup.ts";
import { makePullRequestPreparation } from "./git-manager/pullRequestPreparation.ts";
import { makeStackedAction } from "./git-manager/stackedAction.ts";

export const makeGitManager = Effect.gen(function* () {
  const gitCore = yield* GitCore;
  const gitHubCli = yield* GitHubCli;
  const textGeneration = yield* TextGeneration;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { worktreesDir } = yield* ServerConfig;
  const tempDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "/tmp";

  const lookup = makePullRequestLookup({ gitCore, gitHubCli });
  const headOperations = makePullRequestHeadOperations({ gitCore, gitHubCli });
  const commitOperations = makeCommitOperations({ gitCore, textGeneration });
  const pullRequestCreation = makePullRequestCreation({
    gitCore,
    gitHubCli,
    textGeneration,
    fileSystem,
    path,
    tempDir,
    lookup,
  });
  const readOperations = makeGitReadOperations({
    gitCore,
    gitHubCli,
    textGeneration,
    lookup,
  });
  const pullRequestPreparation = makePullRequestPreparation({
    gitCore,
    gitHubCli,
    headOperations,
  });
  const handoffRuntime = makeHandoffRuntime({ gitCore, path, worktreesDir });
  const handoffThread = makeHandoffThread({ gitCore, runtime: handoffRuntime });
  const runStackedAction = makeStackedAction({
    gitCore,
    commitOperations,
    pullRequestCreation,
  });

  return {
    ...readOperations,
    ...pullRequestPreparation,
    handoffThread,
    runStackedAction,
  } satisfies GitManagerShape;
});

export const GitManagerLive = Layer.effect(GitManager, makeGitManager);
