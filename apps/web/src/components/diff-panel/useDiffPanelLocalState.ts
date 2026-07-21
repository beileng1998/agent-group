import type { TurnId } from "@agent-group/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DiffRenderMode } from "../chat/chatHeaderControls";
import {
  resolveInitialDiffViewKind,
  type DiffPanelTurnScopeIntent,
  type DiffViewKind,
} from "../DiffPanel.logic";

interface UseDiffPanelLocalStateInput {
  diffOpen: boolean;
  selectedTurnId: TurnId | null;
  defaultWordWrap: boolean;
}

export function useDiffPanelLocalState({
  diffOpen,
  selectedTurnId,
  defaultWordWrap,
}: UseDiffPanelLocalStateInput) {
  const [diffRenderMode, setDiffRenderMode] = useState<DiffRenderMode>("split");
  const [diffWordWrap, setDiffWordWrap] = useState(defaultWordWrap);
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(true);
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => new Set());
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const [fileTreeMounted, setFileTreeMounted] = useState(false);
  const [diffViewKind, setDiffViewKind] = useState<DiffViewKind>(() =>
    resolveInitialDiffViewKind(selectedTurnId),
  );
  const [turnScopeIntent, setTurnScopeIntent] = useState<DiffPanelTurnScopeIntent>(() =>
    selectedTurnId === null ? "all" : "last",
  );
  const patchViewportRef = useRef<HTMLDivElement>(null);
  const previousDiffOpenRef = useRef(false);

  const handleScopePickerOpenChange = useCallback((open: boolean) => {
    setScopePickerOpen((previous) => (previous === open ? previous : open));
  }, []);
  const toggleFileTree = useCallback(() => {
    setFileTreeOpen((previous) => !previous);
    setFileTreeMounted(true);
  }, []);
  const closeFileTree = useCallback(() => {
    setFileTreeOpen(false);
  }, []);

  return {
    diffRenderMode,
    setDiffRenderMode,
    diffWordWrap,
    setDiffWordWrap,
    diffIgnoreWhitespace,
    setDiffIgnoreWhitespace,
    scopePickerOpen,
    handleScopePickerOpenChange,
    collapsedFiles,
    setCollapsedFiles,
    fileTreeOpen,
    fileTreeMounted,
    toggleFileTree,
    closeFileTree,
    diffViewKind,
    setDiffViewKind,
    turnScopeIntent,
    setTurnScopeIntent,
    patchViewportRef,
    previousDiffOpenRef,
  };
}

export type DiffPanelLocalState = ReturnType<typeof useDiffPanelLocalState>;

export function useDiffPanelLocalStateSync(
  state: DiffPanelLocalState,
  { diffOpen, selectedTurnId, defaultWordWrap }: UseDiffPanelLocalStateInput,
) {
  const { previousDiffOpenRef, setDiffWordWrap, setDiffViewKind } = state;
  useEffect(() => {
    if (diffOpen && !previousDiffOpenRef.current) {
      setDiffWordWrap(defaultWordWrap);
      setDiffViewKind(resolveInitialDiffViewKind(selectedTurnId));
    }
    previousDiffOpenRef.current = diffOpen;
  }, [
    defaultWordWrap,
    diffOpen,
    previousDiffOpenRef,
    selectedTurnId,
    setDiffViewKind,
    setDiffWordWrap,
  ]);

  useEffect(() => {
    if (selectedTurnId !== null) {
      setDiffViewKind((current) => (current === "turn" ? current : "turn"));
    }
  }, [selectedTurnId, setDiffViewKind]);
}
