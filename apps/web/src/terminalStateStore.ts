/**
 * Single Zustand store for terminal UI state keyed by threadId.
 *
 * Domain transitions live in terminal-state modules; this compatibility entry
 * keeps the public store and selector import path stable.
 */

import type { ThreadId } from "@agent-group/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  applyThreadWorkspaceLayoutPreset,
  closeThreadTerminal,
  closeThreadTerminalGroup,
  newThreadTerminal,
  newThreadTerminalTab,
  openThreadTerminalFullWidth,
  resizeThreadTerminalSplit,
  setThreadActiveTerminal,
  splitThreadTerminal,
  splitThreadTerminalDown,
  splitThreadTerminalLeft,
  splitThreadTerminalUp,
} from "./terminal-state/terminalStateLayout";
import {
  setThreadTerminalActivity,
  setThreadTerminalCliKind,
  setThreadTerminalMetadata,
  setThreadTerminalTitleOverride,
} from "./terminal-state/terminalStateMetadata";
import {
  createDefaultThreadTerminalState,
  sanitizePersistedTerminalStateByThreadId,
  selectThreadTerminalState,
  updateTerminalStateByThreadId,
} from "./terminal-state/terminalStateNormalization";
import {
  closeThreadWorkspaceChat,
  openThreadChatPage,
  openThreadTerminalPage,
  setThreadTerminalHeight,
  setThreadTerminalOpen,
  setThreadTerminalPresentationMode,
  setThreadTerminalWorkspaceLayout,
  setThreadTerminalWorkspaceTab,
} from "./terminal-state/terminalStatePresentation";
import {
  TERMINAL_STATE_STORAGE_KEY,
  type TerminalStateStoreState,
  type ThreadTerminalState,
} from "./terminal-state/terminalStateTypes";

export type { ThreadTerminalState } from "./terminal-state/terminalStateTypes";
export { sanitizePersistedTerminalStateByThreadId, selectThreadTerminalState };

export const useTerminalStateStore = create<TerminalStateStoreState>()(
  persist(
    (set) => {
      const updateTerminal = (
        threadId: ThreadId,
        updater: (state: ThreadTerminalState) => ThreadTerminalState,
      ) => {
        set((state) => {
          const nextTerminalStateByThreadId = updateTerminalStateByThreadId(
            state.terminalStateByThreadId,
            threadId,
            updater,
          );
          if (nextTerminalStateByThreadId === state.terminalStateByThreadId) {
            return state;
          }
          return {
            terminalStateByThreadId: nextTerminalStateByThreadId,
          };
        });
      };

      return {
        terminalStateByThreadId: {},
        openChatThreadPage: (threadId) =>
          updateTerminal(threadId, (state) => openThreadChatPage(state)),
        openTerminalThreadPage: (threadId, options) =>
          updateTerminal(threadId, (state) => openThreadTerminalPage(state, options)),
        setTerminalOpen: (threadId, open) =>
          updateTerminal(threadId, (state) => setThreadTerminalOpen(state, open)),
        setTerminalPresentationMode: (threadId, mode) =>
          updateTerminal(threadId, (state) => setThreadTerminalPresentationMode(state, mode)),
        setTerminalWorkspaceLayout: (threadId, layout) =>
          updateTerminal(threadId, (state) => setThreadTerminalWorkspaceLayout(state, layout)),
        setTerminalWorkspaceTab: (threadId, tab) =>
          updateTerminal(threadId, (state) => setThreadTerminalWorkspaceTab(state, tab)),
        setTerminalHeight: (threadId, height) =>
          updateTerminal(threadId, (state) => setThreadTerminalHeight(state, height)),
        setTerminalMetadata: (threadId, terminalId, metadata) =>
          updateTerminal(threadId, (state) =>
            setThreadTerminalMetadata(state, terminalId, metadata),
          ),
        setTerminalCliKind: (threadId, terminalId, cliKind) =>
          updateTerminal(threadId, (state) => setThreadTerminalCliKind(state, terminalId, cliKind)),
        setTerminalTitleOverride: (threadId, terminalId, titleOverride) =>
          updateTerminal(threadId, (state) =>
            setThreadTerminalTitleOverride(state, terminalId, titleOverride),
          ),
        splitTerminal: (threadId, terminalId) =>
          updateTerminal(threadId, (state) => splitThreadTerminal(state, terminalId)),
        splitTerminalLeft: (threadId, terminalId) =>
          updateTerminal(threadId, (state) => splitThreadTerminalLeft(state, terminalId)),
        splitTerminalRight: (threadId, terminalId) =>
          updateTerminal(threadId, (state) => splitThreadTerminal(state, terminalId)),
        splitTerminalDown: (threadId, terminalId) =>
          updateTerminal(threadId, (state) => splitThreadTerminalDown(state, terminalId)),
        splitTerminalUp: (threadId, terminalId) =>
          updateTerminal(threadId, (state) => splitThreadTerminalUp(state, terminalId)),
        newTerminal: (threadId, terminalId) =>
          updateTerminal(threadId, (state) => newThreadTerminal(state, terminalId)),
        newTerminalTab: (threadId, targetTerminalId, terminalId) =>
          updateTerminal(threadId, (state) =>
            newThreadTerminalTab(state, targetTerminalId, terminalId),
          ),
        openNewFullWidthTerminal: (threadId, terminalId) =>
          updateTerminal(threadId, (state) => openThreadTerminalFullWidth(state, terminalId)),
        closeWorkspaceChat: (threadId) =>
          updateTerminal(threadId, (state) => closeThreadWorkspaceChat(state)),
        setActiveTerminal: (threadId, terminalId) =>
          updateTerminal(threadId, (state) => setThreadActiveTerminal(state, terminalId)),
        closeTerminal: (threadId, terminalId) =>
          updateTerminal(threadId, (state) => closeThreadTerminal(state, terminalId)),
        closeTerminalGroup: (threadId, groupId) =>
          updateTerminal(threadId, (state) => closeThreadTerminalGroup(state, groupId)),
        resizeTerminalSplit: (threadId, groupId, splitId, weights) =>
          updateTerminal(threadId, (state) =>
            resizeThreadTerminalSplit(state, groupId, splitId, weights),
          ),
        setTerminalActivity: (threadId, terminalId, activity) =>
          updateTerminal(threadId, (state) =>
            setThreadTerminalActivity(state, terminalId, activity),
          ),
        applyWorkspaceLayoutPreset: (threadId, presetId, terminalIds) =>
          updateTerminal(threadId, (state) =>
            applyThreadWorkspaceLayoutPreset(state, presetId, terminalIds),
          ),
        clearTerminalState: (threadId) =>
          updateTerminal(threadId, () => createDefaultThreadTerminalState()),
        removeOrphanedTerminalStates: (activeThreadIds) =>
          set((state) => {
            const orphanedIds = Object.keys(state.terminalStateByThreadId).filter(
              (id) => !activeThreadIds.has(id as ThreadId),
            );
            if (orphanedIds.length === 0) return state;
            const next = { ...state.terminalStateByThreadId };
            for (const id of orphanedIds) {
              delete next[id as ThreadId];
            }
            return { terminalStateByThreadId: next };
          }),
      };
    },
    {
      name: TERMINAL_STATE_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        terminalStateByThreadId: sanitizePersistedTerminalStateByThreadId(
          state.terminalStateByThreadId,
        ),
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        terminalStateByThreadId: sanitizePersistedTerminalStateByThreadId(
          (persistedState as Partial<TerminalStateStoreState> | undefined)?.terminalStateByThreadId,
        ),
      }),
    },
  ),
);
