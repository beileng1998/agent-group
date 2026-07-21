// FILE: useComposerMenuSelectionController.ts
// Purpose: Own composer menu selection dispatch and keyboard highlight movement.
// Layer: Web composer controller

import {
  type MessageMentionReference,
  type ModelSlug,
  type ProviderKind,
  type ProviderSkillReference,
  ThreadId,
} from "@agent-group/contracts";
import { isSessionMentionReference } from "@agent-group/shared/messageMentions";
import { useCallback, useRef } from "react";

import type { ComposerTrigger } from "../composer-logic";
import type { ComposerCommandItem } from "../components/chat/ComposerCommandMenu";
import { formatComposerMentionToken, skillMentionPrefix } from "../lib/composerMentions";

type ComposerCommandPicker = null | "fork-target" | "review-target";
type StateUpdater<T> = (next: T | ((existing: T) => T)) => void;

interface TriggerResolution {
  snapshot: { value: string };
  trigger: ComposerTrigger | null;
}

interface UseComposerMenuSelectionControllerOptions {
  applyComposerTriggerReplacement: (params: {
    snapshot: { value: string };
    trigger: ComposerTrigger;
    base: string;
    cursorOffset?: number;
    onApplied?: () => void;
  }) => number | false;
  composerMenuItems: readonly ComposerCommandItem[];
  handleForkTargetSelection: (target: "worktree" | "local") => unknown;
  handleReviewTargetSelection: (target: "changes" | "base-branch") => unknown;
  handleSlashCommandSelection: (
    item: Extract<ComposerCommandItem, { type: "slash-command" }>,
  ) => unknown;
  highlightedItemId: string | null;
  localFolderBrowseRootPath: string | null;
  navigateLocalFolder: (absolutePath: string) => void;
  onProviderModelSelect: (provider: ProviderKind, model: ModelSlug) => void;
  provider: ProviderKind;
  resolveActiveComposerTrigger: () => TriggerResolution;
  scheduleComposerFocus: () => void;
  setCommandPicker: (picker: ComposerCommandPicker) => void;
  setHighlightedItemId: (itemId: string | null) => void;
  updateSelectedMentions: StateUpdater<MessageMentionReference[]>;
  updateSelectedSkills: StateUpdater<ProviderSkillReference[]>;
}

export function useComposerMenuSelectionController(
  options: UseComposerMenuSelectionControllerOptions,
) {
  const {
    applyComposerTriggerReplacement,
    composerMenuItems,
    handleForkTargetSelection,
    handleReviewTargetSelection,
    handleSlashCommandSelection,
    highlightedItemId,
    localFolderBrowseRootPath,
    navigateLocalFolder,
    onProviderModelSelect,
    provider,
    resolveActiveComposerTrigger,
    scheduleComposerFocus,
    setCommandPicker,
    setHighlightedItemId,
    updateSelectedMentions,
    updateSelectedSkills,
  } = options;
  const selectLockRef = useRef(false);

  const selectComposerItem = useCallback(
    (item: ComposerCommandItem) => {
      if (selectLockRef.current) return;
      selectLockRef.current = true;
      window.requestAnimationFrame(() => {
        selectLockRef.current = false;
      });
      if (item.type === "fork-target") {
        setCommandPicker(null);
        setHighlightedItemId(null);
        void handleForkTargetSelection(item.target);
        return;
      }
      if (item.type === "review-target") {
        setCommandPicker(null);
        setHighlightedItemId(null);
        void handleReviewTargetSelection(item.target);
        return;
      }
      const { snapshot, trigger } = resolveActiveComposerTrigger();
      if (!trigger) return;
      if (item.type === "path") {
        applyComposerTriggerReplacement({
          snapshot,
          trigger,
          base: `${formatComposerMentionToken(item.path)} `,
        });
        return;
      }
      if (item.type === "local-root") {
        navigateLocalFolder(localFolderBrowseRootPath ?? "/");
        return;
      }
      if (item.type === "slash-command") {
        handleSlashCommandSelection(item);
        return;
      }
      if (item.type === "provider-native-command") {
        if (provider === "codex" && item.command.toLowerCase() === "review") {
          setCommandPicker("review-target");
          setHighlightedItemId("review-target:changes");
          scheduleComposerFocus();
          return;
        }
        applyComposerTriggerReplacement({
          snapshot,
          trigger,
          base: `/${item.command} `,
        });
        return;
      }
      if (item.type === "skill") {
        applyComposerTriggerReplacement({
          snapshot,
          trigger,
          base: `${skillMentionPrefix(provider)}${item.skill.name} `,
          onApplied: () => {
            updateSelectedSkills((existing) => {
              const nextSkill = {
                name: item.skill.name,
                path: item.skill.path,
              } satisfies ProviderSkillReference;
              return existing.some(
                (skill) => skill.name === nextSkill.name && skill.path === nextSkill.path,
              )
                ? existing
                : [...existing, nextSkill];
            });
          },
        });
        return;
      }
      if (item.type === "plugin") {
        applyComposerTriggerReplacement({
          snapshot,
          trigger,
          base: `${formatComposerMentionToken(item.mention.name)} `,
          onApplied: () => {
            updateSelectedMentions((existing) => {
              const nextMention = item.mention;
              return [
                ...existing.filter((mention) => mention.name !== nextMention.name),
                nextMention,
              ];
            });
          },
        });
        return;
      }
      if (item.type === "session") {
        applyComposerTriggerReplacement({
          snapshot,
          trigger,
          base: `${formatComposerMentionToken(item.mentionName)} `,
          onApplied: () => {
            updateSelectedMentions((existing) => [
              ...existing.filter(
                (mention) =>
                  mention.name !== item.mentionName &&
                  (!isSessionMentionReference(mention) || mention.sessionId !== item.sessionId),
              ),
              {
                kind: "session",
                sessionId: ThreadId.makeUnsafe(item.sessionId),
                name: item.mentionName,
              },
            ]);
          },
        });
        return;
      }
      if (item.type === "model") {
        onProviderModelSelect(item.provider, item.model);
        applyComposerTriggerReplacement({ snapshot, trigger, base: "" });
        return;
      }
      if (item.type === "agent") {
        applyComposerTriggerReplacement({
          snapshot,
          trigger,
          base: `@${item.alias}()`,
          cursorOffset: -1,
        });
      }
    },
    [
      applyComposerTriggerReplacement,
      handleForkTargetSelection,
      handleReviewTargetSelection,
      handleSlashCommandSelection,
      localFolderBrowseRootPath,
      navigateLocalFolder,
      onProviderModelSelect,
      provider,
      resolveActiveComposerTrigger,
      scheduleComposerFocus,
      setCommandPicker,
      setHighlightedItemId,
      updateSelectedMentions,
      updateSelectedSkills,
    ],
  );

  const highlightComposerItem = useCallback(
    (itemId: string | null) => {
      setHighlightedItemId(itemId);
    },
    [setHighlightedItemId],
  );

  const nudgeComposerMenuHighlight = useCallback(
    (key: "ArrowDown" | "ArrowUp") => {
      if (composerMenuItems.length === 0) return;
      const highlightedIndex = composerMenuItems.findIndex((item) => item.id === highlightedItemId);
      const normalizedIndex =
        highlightedIndex >= 0 ? highlightedIndex : key === "ArrowDown" ? -1 : 0;
      const offset = key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        (normalizedIndex + offset + composerMenuItems.length) % composerMenuItems.length;
      setHighlightedItemId(composerMenuItems[nextIndex]?.id ?? null);
    },
    [composerMenuItems, highlightedItemId, setHighlightedItemId],
  );

  return {
    highlightComposerItem,
    nudgeComposerMenuHighlight,
    selectComposerItem,
  };
}
