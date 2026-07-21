// FILE: composerSendDestination.ts
// Purpose: Resolve the project, title, and environment owned by one composer send.
// Layer: Web send orchestration

import { type NativeApi, type ThreadEnvironmentMode } from "@agent-group/contracts";
import { buildPromptThreadTitleFallback } from "@agent-group/shared/chatThreads";

import type { Project } from "../types";
import { resolveFirstSendTarget } from "./chatFirstSend";
import { prepareFirstSendTarget, type PreparedFirstSendTarget } from "./chatFirstSendPreparation";
import {
  buildComposerSendTitleSeed,
  type ComposerSendTitleSeedInput,
} from "./composerSendPreparation";

export type ComposerSendDestinationResult =
  | { readonly kind: "blocked"; readonly error: string }
  | {
      readonly kind: "ready";
      readonly title: string;
      readonly target: PreparedFirstSendTarget;
    };

export async function prepareComposerSendDestination(input: {
  api: NativeApi;
  activeProject: Project;
  activeThread: {
    readonly branch: string | null;
    readonly worktreePath: string | null;
  };
  activeRootBranch: string | null;
  chatWorkspaceRoot: string | null;
  content: ComposerSendTitleSeedInput;
  createdAt: Date;
  initialEnvMode: ThreadEnvironmentMode;
  isContainerLandingProject: boolean;
  isFirstMessage: boolean;
  isHomeChatContainer: boolean;
  isStudioContainer: boolean;
  projects: readonly Project[];
  selectedWorkspaceRoot: string | null;
}): Promise<ComposerSendDestinationResult> {
  const titleSeed = buildComposerSendTitleSeed(input.content);
  const title = buildPromptThreadTitleFallback(titleSeed);
  const firstSendTarget = resolveFirstSendTarget({
    activeProject: input.activeProject,
    chatWorkspaceRoot: input.chatWorkspaceRoot,
    createdAt: input.createdAt,
    isFirstMessage: input.isFirstMessage,
    isHomeChatContainer: input.isHomeChatContainer,
    isStudioContainer: input.isStudioContainer,
    projects: input.projects,
    selectedWorkspaceRoot: input.selectedWorkspaceRoot,
    title,
    titleSeed,
  });
  const preparation = await prepareFirstSendTarget({
    api: input.api,
    activeProject: input.activeProject,
    firstSendTarget,
    firstSendCreatedAt: input.createdAt,
    isFirstMessage: input.isFirstMessage,
    isContainerLandingProject: input.isContainerLandingProject,
    activeRootBranch: input.activeRootBranch,
    initialEnvMode: input.initialEnvMode,
    initialBranch: input.activeThread.branch,
    initialWorktreePath: input.activeThread.worktreePath,
  });
  return preparation.kind === "blocked"
    ? preparation
    : { kind: "ready", title, target: preparation.target };
}
