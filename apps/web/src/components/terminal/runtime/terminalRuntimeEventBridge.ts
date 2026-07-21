import { describeErrorMessage } from "@agent-group/shared/errorMessages";
import {
  consumeTerminalIdentityInput,
  defaultTerminalTitleForCliKind,
} from "@agent-group/shared/terminalThreads";

import { readNativeApi } from "~/nativeApi";

import { openInPreferredEditor } from "../../../editorPreferences";
import { isTerminalClearShortcut, terminalNavigationShortcutData } from "../../../keybindings";
import {
  collectWrappedTerminalLinkLine,
  extractTerminalLinks,
  isTerminalLinkActivation,
  resolvePathLinkTarget,
  resolveWrappedTerminalLinkRange,
  wrappedTerminalLinkRangeIntersectsBufferLine,
} from "../../../terminal-links";
import { addWsTransportStateListener } from "../../../wsTransportEvents";
import { terminalEventDispatcher } from "../terminalEventDispatcher";
import { writeSystemMessage } from "../terminalRuntimeAppearance";
import type { TerminalRuntimeEntry } from "../terminalRuntimeTypes";
import {
  buildTerminalOpenInput,
  setTerminalRuntimeStatus,
  terminalSnapshotHasReplayPayload,
} from "./terminalRuntimeContract";
import {
  clearPendingTerminalWrites,
  flushPendingTerminalWrites,
  replayTerminalSnapshot,
  scheduleTerminalWrite,
  terminalByteLength,
} from "./terminalRuntimeOutput";
import { syncTerminalTheme } from "./terminalRuntimePresentation";

const LINK_MATCH_CACHE_LIMIT = 512;

function readCachedTerminalLinks(entry: TerminalRuntimeEntry, line: string) {
  const cached = entry.linkMatchCache.get(line);
  if (cached) return cached;

  const matches = extractTerminalLinks(line);
  if (entry.linkMatchCache.size >= LINK_MATCH_CACHE_LIMIT) {
    entry.linkMatchCache.clear();
  }
  entry.linkMatchCache.set(line, matches);
  return matches;
}

async function sendTerminalInput(
  entry: TerminalRuntimeEntry,
  data: string,
  fallbackError: string,
): Promise<void> {
  const api = readNativeApi();
  if (!api) return;
  try {
    await api.terminal.write({ threadId: entry.threadId, terminalId: entry.terminalId, data });
  } catch (error) {
    writeSystemMessage(entry.terminal, describeErrorMessage(error, fallbackError));
  }
}

function reconcileTerminalSnapshot(entry: TerminalRuntimeEntry): void {
  if (entry.disposed || !entry.opened || entry.hasHandledExit) return;
  const api = readNativeApi();
  if (!api) return;

  const outputEventVersionAtRequest = entry.outputEventVersion;
  const requestId = ++entry.snapshotReconcileRequestId;
  setTerminalRuntimeStatus(entry, "connecting");

  void api.terminal
    .open(buildTerminalOpenInput(entry))
    .then((snapshot) => {
      if (
        entry.disposed ||
        !entry.opened ||
        entry.hasHandledExit ||
        entry.snapshotReconcileRequestId !== requestId
      ) {
        return;
      }

      if (entry.outputEventVersion !== outputEventVersionAtRequest) return;

      if (terminalSnapshotHasReplayPayload(snapshot)) {
        replayTerminalSnapshot(entry, snapshot, () => {
          if (!entry.disposed && entry.snapshotReconcileRequestId === requestId) {
            setTerminalRuntimeStatus(entry, "ready");
          }
        });
        return;
      }

      setTerminalRuntimeStatus(entry, "ready");
    })
    .catch((error) => {
      if (entry.disposed || !entry.opened || entry.snapshotReconcileRequestId !== requestId) return;
      setTerminalRuntimeStatus(entry, "error");
      writeSystemMessage(
        entry.terminal,
        error instanceof Error ? error.message : "Failed to reconnect terminal",
      );
    });
}

function installCopyBridge(entry: TerminalRuntimeEntry): void {
  const handleCopy = (event: ClipboardEvent) => {
    const selection = entry.terminal.getSelection();
    if (!selection) return;
    const trimmed = selection.replace(/[^\S\n]+$/gm, "");
    if (trimmed === selection) return;

    if (event.clipboardData) {
      event.preventDefault();
      event.clipboardData.setData("text/plain", trimmed);
      return;
    }

    void navigator.clipboard?.writeText(trimmed).catch(() => undefined);
  };
  entry.wrapper.addEventListener("copy", handleCopy);
  entry.persistentDisposables.push(() => {
    entry.wrapper.removeEventListener("copy", handleCopy);
  });
}

function installTransportBridge(entry: TerminalRuntimeEntry): void {
  const unsubscribeTransportState = addWsTransportStateListener((state) => {
    if (entry.disposed || !entry.opened || entry.hasHandledExit) return;
    if (state === "open") {
      reconcileTerminalSnapshot(entry);
      return;
    }
    if (state === "connecting" || state === "closed") {
      setTerminalRuntimeStatus(entry, "connecting");
    }
  });
  entry.persistentDisposables.push(unsubscribeTransportState);
}

function installKeyboardBridge(entry: TerminalRuntimeEntry): void {
  entry.terminal.attachCustomKeyEventHandler((event) => {
    if (
      event.type === "keydown" &&
      event.key === "Enter" &&
      event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      void sendTerminalInput(entry, "\n", "Failed to insert newline");
      return false;
    }

    if (
      event.type === "keydown" &&
      event.key.toLowerCase() === "f" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey
    ) {
      return true;
    }

    const navigationData = terminalNavigationShortcutData(event);
    if (navigationData !== null) {
      event.preventDefault();
      event.stopPropagation();
      void sendTerminalInput(entry, navigationData, "Failed to move cursor");
      return false;
    }

    if (!isTerminalClearShortcut(event)) return true;
    event.preventDefault();
    event.stopPropagation();
    void sendTerminalInput(entry, "\u000c", "Failed to clear terminal");
    return false;
  });
}

function installLinkBridge(entry: TerminalRuntimeEntry): void {
  const terminal = entry.terminal;
  entry.terminalDisposables.push(
    terminal.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) => {
        const wrappedLine = collectWrappedTerminalLinkLine(bufferLineNumber, (bufferLineIndex) =>
          terminal.buffer.active.getLine(bufferLineIndex),
        );
        if (!wrappedLine) {
          callback(undefined);
          return;
        }

        const links = readCachedTerminalLinks(entry, wrappedLine.text)
          .map((match) => ({
            match,
            range: resolveWrappedTerminalLinkRange(wrappedLine, match),
          }))
          .filter(({ range }) =>
            wrappedTerminalLinkRangeIntersectsBufferLine(range, bufferLineNumber),
          );
        if (links.length === 0) {
          callback(undefined);
          return;
        }

        callback(
          links.map(({ match, range }) => ({
            text: match.text,
            range,
            activate: (event: MouseEvent) => {
              if (!isTerminalLinkActivation(event)) return;
              const api = readNativeApi();
              if (!api) return;

              if (match.kind === "url") {
                void api.shell.openExternal(match.text).catch((error) => {
                  writeSystemMessage(terminal, describeErrorMessage(error, "Unable to open link"));
                });
                return;
              }

              const target = resolvePathLinkTarget(match.text, entry.cwd);
              void openInPreferredEditor(api, target).catch((error) => {
                writeSystemMessage(terminal, describeErrorMessage(error, "Unable to open path"));
              });
            },
          })),
        );
      },
    }),
  );
}

function installInputBridge(entry: TerminalRuntimeEntry): void {
  entry.terminalDisposables.push(
    entry.terminal.onData((data) => {
      const nextIdentityState = consumeTerminalIdentityInput(entry.titleInputBuffer, data);
      entry.titleInputBuffer = nextIdentityState.buffer;
      const submittedIdentity = nextIdentityState.identity;
      if (submittedIdentity && (submittedIdentity.cliKind || entry.terminalCliKind !== null)) {
        entry.terminalCliKind = submittedIdentity.cliKind;
        entry.callbacks.onTerminalMetadataChange(entry.terminalId, {
          cliKind: submittedIdentity.cliKind,
          label: submittedIdentity.title,
        });
      }
      const api = readNativeApi();
      if (!api) return;
      void api.terminal
        .write({ threadId: entry.threadId, terminalId: entry.terminalId, data })
        .catch((error) =>
          writeSystemMessage(entry.terminal, describeErrorMessage(error, "Terminal write failed")),
        );
    }),
  );
}

function installThemeBridge(entry: TerminalRuntimeEntry): void {
  entry.themeObserver = new MutationObserver(() => {
    if (entry.themeRefreshFrame !== 0) return;
    entry.themeRefreshFrame = window.requestAnimationFrame(() => {
      entry.themeRefreshFrame = 0;
      syncTerminalTheme(entry);
    });
  });
  entry.themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
}

function installBackendEventBridge(entry: TerminalRuntimeEntry): void {
  const terminal = entry.terminal;
  entry.unsubscribeTerminalEvents = terminalEventDispatcher.subscribe(
    entry.threadId,
    entry.terminalId,
    (event) => {
      if (event.type === "output") {
        setTerminalRuntimeStatus(entry, "ready");
        entry.outputEventVersion += 1;
        scheduleTerminalWrite(
          entry,
          event.data,
          event.byteLength ?? terminalByteLength(event.data),
        );
        return;
      }

      if (event.type === "started" || event.type === "restarted") {
        entry.hasHandledExit = false;
        const shouldReplaySnapshot =
          event.type === "restarted" || terminalSnapshotHasReplayPayload(event.snapshot);
        if (shouldReplaySnapshot) {
          replayTerminalSnapshot(entry, event.snapshot, () =>
            setTerminalRuntimeStatus(entry, "ready"),
          );
        } else {
          setTerminalRuntimeStatus(entry, "ready");
        }
        return;
      }

      if (event.type === "cleared") {
        entry.titleInputBuffer = "";
        entry.linkMatchCache.clear();
        clearPendingTerminalWrites(entry);
        terminal.clear();
        terminal.write("\u001bc");
        return;
      }

      if (event.type === "activity") {
        if (entry.terminalCliKind !== event.cliKind) {
          entry.terminalCliKind = event.cliKind;
          entry.callbacks.onTerminalMetadataChange(entry.terminalId, {
            cliKind: event.cliKind,
            label: event.cliKind ? defaultTerminalTitleForCliKind(event.cliKind) : "Terminal",
          });
        }
        entry.callbacks.onTerminalActivityChange(entry.terminalId, {
          hasRunningSubprocess: event.hasRunningSubprocess,
          agentState: event.agentState,
        });
        return;
      }

      if (event.type === "error") {
        setTerminalRuntimeStatus(entry, "error");
        writeSystemMessage(terminal, event.message);
        return;
      }

      if (event.type === "exited") {
        flushPendingTerminalWrites(entry);
        const details = [
          typeof event.exitCode === "number" ? `code ${event.exitCode}` : null,
          typeof event.exitSignal === "number" ? `signal ${event.exitSignal}` : null,
        ]
          .filter((value): value is string => value !== null)
          .join(", ");
        writeSystemMessage(
          terminal,
          details.length > 0 ? `Process exited (${details})` : "Process exited",
        );
        if (entry.hasHandledExit) return;
        entry.hasHandledExit = true;
        window.setTimeout(() => {
          if (!entry.hasHandledExit) return;
          entry.callbacks.onSessionExited();
        }, 0);
      }
    },
  );
}

export function installTerminalRuntimeEventBridges(entry: TerminalRuntimeEntry): void {
  installCopyBridge(entry);
  installTransportBridge(entry);
  installKeyboardBridge(entry);
  installLinkBridge(entry);
  installInputBridge(entry);
  installThemeBridge(entry);
  installBackendEventBridge(entry);
}
