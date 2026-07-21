// FILE: useComposerFocusController.ts
// Purpose: Own Composer focus requests and Terminal-to-Composer focus handoff.
// Layer: Web composer controller

import { type ThreadId } from "@agent-group/contracts";
import { useCallback, useEffect, useRef } from "react";

import type { ComposerPromptEditorHandle } from "../components/ComposerPromptEditor";
import { useComposerFocusRequestStore } from "../composerFocusRequestStore";
import { useIsMobile, useMediaQuery } from "./useMediaQuery";

export function shouldAutoFocusComposerOnThreadActivation(input: {
  activeThreadId: ThreadId | null;
  inactiveSplitPane: boolean;
  terminalOpen: boolean;
  mobileViewport: boolean;
  coarsePointer: boolean;
}): boolean {
  return (
    input.activeThreadId !== null &&
    !input.inactiveSplitPane &&
    !input.terminalOpen &&
    !input.mobileViewport &&
    !input.coarsePointer
  );
}

export function useComposerFocusController(input: {
  threadId: ThreadId;
  activeThreadId: ThreadId | null;
  secondaryChromeThreadId: ThreadId;
  secondaryChromeReady: boolean;
  editorDisabled: boolean;
  inactiveSplitPane: boolean;
  terminalOpen: boolean;
  terminalEntryPoint: "chat" | "terminal";
  terminalWorkspaceOpen: boolean;
  terminalWorkspaceActiveTab: "chat" | "terminal";
  requestTerminalFocus: () => void;
  openTerminalThreadPage: (threadId: ThreadId) => void;
}) {
  const mobileViewport = useIsMobile();
  const coarsePointer = useMediaQuery({ pointer: "coarse" });
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const pendingFocusRef = useRef(false);
  const terminalOpenByThreadRef = useRef<Record<string, boolean>>({});
  const activatedThreadIdRef = useRef<ThreadId | null>(null);
  const focusRequestNonce = useComposerFocusRequestStore(
    (store) => store.requestsByThreadId[input.threadId] ?? 0,
  );

  const focus = useCallback(() => {
    const editor = editorRef.current;
    if (!input.secondaryChromeReady || !editor || input.editorDisabled) {
      pendingFocusRef.current = true;
      return;
    }
    pendingFocusRef.current = false;
    editor.focusAtEnd();
  }, [input.editorDisabled, input.secondaryChromeReady]);
  const toggle = useCallback(() => {
    const editor = editorRef.current;
    if (input.secondaryChromeReady && editor?.isFocused()) {
      pendingFocusRef.current = false;
      editor.blur();
      return;
    }
    focus();
  }, [focus, input.secondaryChromeReady]);
  const schedule = useCallback(() => {
    pendingFocusRef.current = true;
    window.requestAnimationFrame(focus);
  }, [focus]);

  useEffect(() => {
    if (focusRequestNonce > 0) schedule();
  }, [focusRequestNonce, schedule]);
  useEffect(() => {
    if (!input.secondaryChromeReady || !pendingFocusRef.current) return;
    const frame = window.requestAnimationFrame(focus);
    return () => window.cancelAnimationFrame(frame);
  }, [focus, input.secondaryChromeReady, input.secondaryChromeThreadId]);
  useEffect(() => {
    if (
      !shouldAutoFocusComposerOnThreadActivation({
        activeThreadId: input.activeThreadId,
        inactiveSplitPane: input.inactiveSplitPane,
        terminalOpen: input.terminalOpen,
        mobileViewport,
        coarsePointer,
      })
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(focus);
    return () => window.cancelAnimationFrame(frame);
  }, [
    coarsePointer,
    focus,
    input.activeThreadId,
    input.inactiveSplitPane,
    input.terminalOpen,
    mobileViewport,
  ]);
  useEffect(() => {
    if (!input.activeThreadId) return;
    const previous = terminalOpenByThreadRef.current[input.activeThreadId] ?? false;
    if (!previous && input.terminalOpen) {
      terminalOpenByThreadRef.current[input.activeThreadId] = true;
      input.requestTerminalFocus();
      return;
    }
    if (previous && !input.terminalOpen) {
      terminalOpenByThreadRef.current[input.activeThreadId] = false;
      const frame = window.requestAnimationFrame(focus);
      return () => window.cancelAnimationFrame(frame);
    }
    terminalOpenByThreadRef.current[input.activeThreadId] = input.terminalOpen;
  }, [focus, input.activeThreadId, input.requestTerminalFocus, input.terminalOpen]);
  useEffect(() => {
    if (!input.activeThreadId) {
      activatedThreadIdRef.current = null;
      return;
    }
    if (activatedThreadIdRef.current === input.activeThreadId) return;
    activatedThreadIdRef.current = input.activeThreadId;
    if (input.terminalEntryPoint === "terminal") {
      input.openTerminalThreadPage(input.activeThreadId);
    }
  }, [input.activeThreadId, input.openTerminalThreadPage, input.terminalEntryPoint]);
  useEffect(() => {
    if (!input.terminalWorkspaceOpen) return;
    if (input.terminalWorkspaceActiveTab === "terminal") {
      input.requestTerminalFocus();
      return;
    }
    const frame = window.requestAnimationFrame(focus);
    return () => window.cancelAnimationFrame(frame);
  }, [
    focus,
    input.requestTerminalFocus,
    input.terminalWorkspaceActiveTab,
    input.terminalWorkspaceOpen,
  ]);

  return { editorRef, formRef, focus, schedule, toggle };
}
