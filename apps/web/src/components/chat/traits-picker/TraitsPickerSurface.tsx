import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Menu } from "../../ui/menu";
import { ComposerPickerMenuPopup } from "../ComposerPickerMenuPopup";
import { getComposerTraitSelection, hasVisibleComposerTraitControls } from "../composerTraits";
import { TraitsMenuContent, type TraitsMenuContentProps } from "./TraitsMenuContent";
import {
  defaultAgentForProvider,
  getAgentOptions,
  resolveTraitsTriggerSummary,
} from "./traitsPickerModel";
import { TraitsPickerTrigger } from "./TraitsPickerTrigger";

export const TraitsPicker = memo(function TraitsPicker({
  provider,
  threadId,
  model,
  runtimeModel,
  runtimeAgents,
  prompt,
  onPromptChange,
  includeFastMode = true,
  modelOptions,
  open,
  onOpenChange,
  onSelectionCommitted,
  shortcutLabel,
  hideLabel = false,
}: TraitsMenuContentProps & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelectionCommitted?: () => void;
  shortcutLabel?: string | null;
  hideLabel?: boolean;
}) {
  const [uncontrolledMenuOpen, setUncontrolledMenuOpen] = useState(false);
  const selectionCommitTimerRef = useRef<number | null>(null);
  const isMenuOpen = open ?? uncontrolledMenuOpen;
  const setMenuOpen = useCallback(
    (nextOpen: boolean) => {
      if (open === undefined) setUncontrolledMenuOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, open],
  );
  const scheduleSelectionCommitted = useCallback(() => {
    if (selectionCommitTimerRef.current !== null) {
      window.clearTimeout(selectionCommitTimerRef.current);
    }
    selectionCommitTimerRef.current = window.setTimeout(() => {
      selectionCommitTimerRef.current = null;
      onSelectionCommitted?.();
    }, 0);
  }, [onSelectionCommitted]);
  useEffect(
    () => () => {
      if (selectionCommitTimerRef.current !== null) {
        window.clearTimeout(selectionCommitTimerRef.current);
      }
    },
    [],
  );
  const handleSelectionComplete = useCallback(() => {
    setMenuOpen(false);
    scheduleSelectionCommitted();
  }, [scheduleSelectionCommitted, setMenuOpen]);
  const { caps, effortLevels, thinkingEnabled, contextWindowOptions, fastModeDescriptor } =
    getComposerTraitSelection(provider, model, prompt, modelOptions, runtimeModel);
  const hasVisibleControls = hasVisibleComposerTraitControls(
    { caps, effortLevels, thinkingEnabled, contextWindowOptions, fastModeDescriptor },
    { includeFastMode },
  );
  const agentOptions = getAgentOptions(provider, runtimeAgents);
  const defaultAgent = defaultAgentForProvider(provider);
  const hasAgentControls = agentOptions.length > 0 && defaultAgent !== null;

  if (!hasVisibleControls && !hasAgentControls) return null;

  const { contextWindowLabel, primaryLabel, showsFastBadge, summaryText } =
    resolveTraitsTriggerSummary({
      provider,
      model,
      prompt,
      modelOptions,
      runtimeModel,
      runtimeAgents,
    });

  return (
    <Menu open={isMenuOpen} onOpenChange={setMenuOpen}>
      <TraitsPickerTrigger
        providerIsCodex={provider === "codex"}
        hideLabel={hideLabel}
        hiddenLabelTitle={summaryText}
        primaryLabel={primaryLabel}
        showsFastBadge={showsFastBadge}
        contextWindowLabel={contextWindowLabel}
        shortcutLabel={shortcutLabel}
        isMenuOpen={isMenuOpen}
      />
      <ComposerPickerMenuPopup align="start" fixedWidth>
        <TraitsMenuContent
          provider={provider}
          threadId={threadId}
          model={model}
          runtimeModel={runtimeModel}
          runtimeAgents={runtimeAgents}
          prompt={prompt}
          onPromptChange={onPromptChange}
          includeFastMode={includeFastMode}
          modelOptions={modelOptions}
          onSelectionComplete={handleSelectionComplete}
        />
      </ComposerPickerMenuPopup>
    </Menu>
  );
});
