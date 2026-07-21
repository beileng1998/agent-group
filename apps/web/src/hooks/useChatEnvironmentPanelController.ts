// FILE: useChatEnvironmentPanelController.ts
// Purpose: Own Environment panel visibility, preference, repository, and recap state.
// Layer: Web chat environment controller

import type { GitHubRepositoryResult, ProviderStartOptions } from "@agent-group/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

import {
  resolveDefaultEnvironmentPanelOpen,
  resolveEnvironmentPanelOpen,
  resolveEnvironmentPanelPreferenceUpdate,
  resolveEnvironmentPanelVisible,
} from "../components/ChatView.environmentModel";
import { gitGithubRepositoryQueryOptions } from "../lib/gitReactQuery";
import type { Thread } from "../types";
import { useThreadRecap, type UseThreadRecapResult } from "./useThreadRecap";
import { useIsMobile } from "./useMediaQuery";

const ENVIRONMENT_PANEL_ENABLED = false;

export interface ChatEnvironmentPanelControllerInput {
  readonly layout: {
    readonly centeredEmptyLanding: boolean;
    readonly terminalPrimarySurface: boolean;
    readonly terminalEnvironmentContext: boolean;
    readonly rightDockOpen: boolean;
    readonly surfaceMode: "single" | "split";
  };
  readonly settings: {
    readonly defaultOpen: boolean;
    readonly codexHomePath: string | null | undefined;
    readonly update: (patch: { readonly environmentPanelDefaultOpen: boolean }) => void;
  };
  readonly workspace: {
    readonly branchSourceCwd: string | null;
    readonly cwd: string | null;
  };
  readonly runtime: {
    readonly thread: Thread | null | undefined;
    readonly latestTurnSettled: boolean;
    readonly providerOptions: ProviderStartOptions | null | undefined;
  };
}

export interface ChatEnvironmentPanelController {
  readonly enabled: boolean;
  readonly defaultOpen: boolean;
  readonly open: boolean;
  readonly visible: boolean;
  readonly appliesContentInset: boolean;
  readonly usesFloatingOverlay: boolean;
  readonly variant: "docked" | "floating";
  readonly preferenceOpen: boolean | null;
  readonly setPreferenceOpen: Dispatch<SetStateAction<boolean | null>>;
  readonly updatePreference: (open: boolean, persist: boolean) => void;
  readonly closeAfterAction: () => void;
  readonly githubRepository: GitHubRepositoryResult["repository"];
  readonly githubRepositories: GitHubRepositoryResult["repositories"];
  readonly recap: UseThreadRecapResult;
}

export function useChatEnvironmentPanelController(
  input: ChatEnvironmentPanelControllerInput,
): ChatEnvironmentPanelController {
  const enabled = ENVIRONMENT_PANEL_ENABLED;
  const mobileViewport = useIsMobile();
  const usesFloatingOverlay =
    input.layout.terminalEnvironmentContext ||
    mobileViewport ||
    input.layout.rightDockOpen ||
    input.layout.surfaceMode === "split";
  const defaultOpen = resolveDefaultEnvironmentPanelOpen({
    environmentEnabled: enabled,
    isCenteredEmptyLanding: input.layout.centeredEmptyLanding,
    isTerminalPrimarySurface: input.layout.terminalPrimarySurface,
    isConstrainedChatLayout: usesFloatingOverlay,
    settingsDefaultOpen: input.settings.defaultOpen,
  });
  const [preferenceOpen, setPreferenceOpen] = useState<boolean | null>(null);
  const updatePreference = useCallback(
    (open: boolean, persist: boolean) => {
      const update = resolveEnvironmentPanelPreferenceUpdate({ open, persist });
      setPreferenceOpen(update.userPreferenceOpen);
      if (update.settingsDefaultOpen !== null) {
        input.settings.update({
          environmentPanelDefaultOpen: update.settingsDefaultOpen,
        });
      }
    },
    [input.settings.update],
  );
  const closeAfterAction = useCallback(() => updatePreference(false, false), [updatePreference]);
  const open = resolveEnvironmentPanelOpen({
    defaultOpen,
    userPreferenceOpen: preferenceOpen,
  });
  const visible = resolveEnvironmentPanelVisible({
    environmentEnabled: enabled,
    environmentPanelOpen: open,
  });
  const githubRepositoryQuery = useQuery(
    gitGithubRepositoryQueryOptions(input.workspace.branchSourceCwd, visible),
  );
  const recap = useThreadRecap({
    thread: input.runtime.thread,
    cwd: input.workspace.cwd,
    enabled: visible,
    latestTurnSettled: input.runtime.latestTurnSettled,
    codexHomePath: input.settings.codexHomePath || null,
    providerOptions: input.runtime.providerOptions ?? null,
  });

  return {
    enabled,
    defaultOpen,
    open,
    visible,
    appliesContentInset: visible && !usesFloatingOverlay,
    usesFloatingOverlay,
    variant: usesFloatingOverlay ? "floating" : "docked",
    preferenceOpen,
    setPreferenceOpen,
    updatePreference,
    closeAfterAction,
    githubRepository: githubRepositoryQuery.data?.repository ?? null,
    githubRepositories: githubRepositoryQuery.data?.repositories ?? [],
    recap,
  };
}
