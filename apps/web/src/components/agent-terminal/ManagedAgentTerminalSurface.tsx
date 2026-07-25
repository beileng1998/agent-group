import "@xterm/xterm/css/xterm.css";

import {
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
  type TerminalAgentEvent,
  type TerminalAgentAttachedEvent,
} from "@agent-group/contracts";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type IDisposable } from "@xterm/xterm";
import { useEffect, useRef } from "react";

import {
  getTerminalBoldFontWeight,
  getTerminalFontFamily,
  getTerminalFontSizePx,
  getTerminalFontWeight,
  terminalThemeFromApp,
} from "../terminal/terminalRuntimeAppearance";
import type { AgentGroupTerminalOptions } from "../terminal/runtime/terminalRuntimeContract";
import { Button } from "../ui/button";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import {
  Loader2Icon,
  RefreshCwIcon,
  StopFilledIcon,
  TriangleAlertIcon,
} from "../../lib/icons";
import { readNativeApi } from "../../nativeApi";
import { toastManager } from "../ui/toast";
import { useManagedAgentTerminal } from "./ManagedAgentTerminalContext";
import { ManagedTerminalInputQueue } from "./managedTerminalInputQueue";
import { ManagedTerminalOutputPump } from "./managedTerminalOutputPump";
import { ManagedTerminalSnapshotGuard } from "./managedTerminalSnapshotGuard";
import { isTerminalQueryReply } from "./terminalQueryReply";
import {
  buildManagedTerminalSnapshotAnsi,
  canRestartManagedTerminal,
  classifyManagedTerminalOutput,
  managedTerminalEventThreadId,
  managedTerminalProviderLabel,
  managedTerminalStatusLabel,
  splitManagedTerminalInput,
} from "./managedTerminalPresentation";

const BACKEND_RESIZE_DEBOUNCE_MS = 100;

type AttachmentFence = {
  revision: number;
  generation: string;
  outputSequence: number;
  acceptedOutputSequence: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fitTerminal(terminal: Terminal, fitAddon: FitAddon): { cols: number; rows: number } {
  fitAddon.fit();
  const cols = clamp(terminal.cols, TERMINAL_MIN_COLS, TERMINAL_MAX_COLS);
  const rows = clamp(terminal.rows, TERMINAL_MIN_ROWS, TERMINAL_MAX_ROWS);
  if (cols !== terminal.cols || rows !== terminal.rows) terminal.resize(cols, rows);
  return { cols, rows };
}

function snapshotWrite(event: TerminalAgentAttachedEvent): string {
  const { snapshot } = event;
  return `\u001bc${buildManagedTerminalSnapshotAnsi(snapshot)}`;
}

export function ManagedAgentTerminalSurface() {
  const controller = useManagedAgentTerminal();
  const mountRef = useRef<HTMLDivElement>(null);
  const active = controller?.active === true;
  const threadId = controller?.threadId;
  const setViewportSize = controller?.setViewportSize;

  useEffect(() => {
    const mount = mountRef.current;
    const api = readNativeApi();
    if (
      !active ||
      !threadId ||
      !setViewportSize ||
      !mount ||
      !api?.terminalAgent
    ) {
      return;
    }

    const fitAddon = new FitAddon();
    const terminalOptions: AgentGroupTerminalOptions = {
      allowProposedApi: true,
      allowTransparency: false,
      cursorBlink: true,
      customGlyphs: true,
      fontFamily: getTerminalFontFamily(),
      fontSize: getTerminalFontSizePx(),
      fontWeight: getTerminalFontWeight(),
      fontWeightBold: getTerminalBoldFontWeight(),
      scrollback: 5_000,
      theme: terminalThemeFromApp(),
      vtExtensions: { kittyKeyboard: true },
      scrollbar: { showScrollbar: false },
    };
    const terminal = new Terminal(terminalOptions);
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = "11";
    terminal.open(mount);

    let disposed = false;
    let resizeFrame = 0;
    let resizeTimer: number | null = null;
    let webglAddon: WebglAddon | null = null;
    let fence: AttachmentFence | null = null;
    let lastSentSize: { cols: number; rows: number } | null = null;
    let unsubscribe = () => {};
    let resubscribeTimer: number | null = null;
    let resyncPending = false;

    const sendResize = (cols: number, rows: number) => {
      setViewportSize(cols, rows);
      if (!fence || (lastSentSize?.cols === cols && lastSentSize.rows === rows)) {
        return;
      }
      lastSentSize = { cols, rows };
      void api.terminalAgent
        .resize({
          threadId,
          revision: fence.revision,
          generation: fence.generation,
          cols,
          rows,
        })
        .catch(() => {
          if (lastSentSize?.cols === cols && lastSentSize.rows === rows) {
            lastSentSize = null;
          }
        });
    };
    const runFit = () => {
      if (disposed || mount.clientWidth <= 1 || mount.clientHeight <= 1) return;
      const size = fitTerminal(terminal, fitAddon);
      setViewportSize(size.cols, size.rows);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        sendResize(size.cols, size.rows);
      }, BACKEND_RESIZE_DEBOUNCE_MS);
    };
    const scheduleFit = () => {
      if (resizeFrame !== 0) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        runFit();
      });
    };

    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(mount);
    scheduleFit();

    let requestSnapshotResync = () => {};
    const inputQueue = new ManagedTerminalInputQueue(
      (inputFence, data) =>
        api.terminalAgent.write({
          threadId,
          revision: inputFence.revision,
          generation: inputFence.generation,
          data,
        }),
      () => {
        toastManager.add({
          type: "warning",
          title: "Terminal input paused",
          description: "Reconnecting to verify terminal state before accepting more input.",
        });
        requestSnapshotResync();
      },
    );
    let keyboardData: string | null = null;
    const keyDisposable: IDisposable = terminal.onKey(({ key }) => {
      keyboardData = key;
      queueMicrotask(() => {
        if (keyboardData === key) keyboardData = null;
      });
    });
    const inputDisposable: IDisposable = terminal.onData((data) => {
      const cameFromKeyboard = keyboardData === data;
      if (cameFromKeyboard) keyboardData = null;
      if (!cameFromKeyboard && isTerminalQueryReply(data)) return;
      for (const chunk of splitManagedTerminalInput(data)) {
        inputQueue.enqueue(chunk);
      }
    });
    requestSnapshotResync = () => {
      if (disposed || resyncPending) return;
      resyncPending = true;
      fence = null;
      inputQueue.setFence(null);
      unsubscribe();
      resubscribeTimer = window.setTimeout(() => {
        resubscribeTimer = null;
        if (disposed) return;
        subscribe();
      }, 0);
    };
    const outputPump = new ManagedTerminalOutputPump(
      terminal,
      requestSnapshotResync,
    );
    const snapshotGuard = new ManagedTerminalSnapshotGuard();
    const handleTerminalEvent = (event: TerminalAgentEvent) => {
      if (disposed || managedTerminalEventThreadId(event) !== threadId) return;
      if (event.type === "state") {
        snapshotGuard.observeFence(
          event.state.authority === "terminal" && event.state.generation
            ? {
                revision: event.state.revision,
                generation: event.state.generation,
              }
            : null,
        );
        if (
          event.state.authority !== "terminal" ||
          event.state.status === "starting" ||
          event.state.status === "stopping" ||
          event.state.status === "stopped" ||
          event.state.status === "exited" ||
          event.state.status === "unsupported" ||
          (fence &&
            (event.state.revision !== fence.revision ||
              event.state.generation !== fence.generation))
        ) {
          fence = null;
          inputQueue.setFence(null);
          outputPump.invalidate();
        }
        return;
      }
      if (event.type === "attached") {
        const restoredAnsi = snapshotWrite(event);
        const snapshotDecision = snapshotGuard.evaluate(
          { revision: event.revision, generation: event.generation },
          restoredAnsi,
        );
        if (snapshotDecision !== "accept") {
          fence = null;
          inputQueue.setFence(null);
          outputPump.invalidate();
          if (snapshotDecision === "oversized") {
            toastManager.add({
              type: "error",
              title: "Terminal snapshot is too large",
              description:
                "Restart the terminal to create a fresh rendering epoch.",
            });
          }
          return;
        }
        fence = {
          revision: event.revision,
          generation: event.generation,
          outputSequence: event.snapshot.outputSequence,
          acceptedOutputSequence: event.snapshot.outputSequence,
        };
        inputQueue.setFence({
          revision: event.revision,
          generation: event.generation,
        });
        lastSentSize = null;
        resyncPending = false;
        try {
          terminal.resize(event.snapshot.cols, event.snapshot.rows);
        } catch {
          requestSnapshotResync();
          return;
        }
        if (!outputPump.reset(restoredAnsi, scheduleFit)) return;
        return;
      }
      if (event.type === "output" && fence) {
        const outputFence = fence;
        const decision = classifyManagedTerminalOutput({
          attachedRevision: outputFence.revision,
          attachedGeneration: outputFence.generation,
          outputSequence: outputFence.acceptedOutputSequence,
          revision: event.revision,
          generation: event.generation,
          seq: event.seq,
        });
        if (decision === "resync") {
          outputPump.invalidate();
          requestSnapshotResync();
        } else if (decision === "write") {
          if (
            outputPump.enqueue(event.data, () => {
              if (fence === outputFence) {
                outputFence.outputSequence = event.seq;
              }
            })
          ) {
            outputFence.acceptedOutputSequence = event.seq;
          }
        }
      } else if (
        event.type === "exited" &&
        fence?.revision === event.revision &&
        fence.generation === event.generation
      ) {
        fence = null;
        inputQueue.setFence(null);
        outputPump.invalidate();
      } else if (
        event.type === "error" &&
        fence?.revision === event.revision &&
        (event.generation === null || fence.generation === event.generation)
      ) {
        fence = null;
        inputQueue.setFence(null);
        outputPump.invalidate();
      }
    };
    const subscribe = () => {
      if (disposed) return;
      try {
        unsubscribe = api.terminalAgent.subscribe(
          { threadId, mode: "terminal" },
          handleTerminalEvent,
        );
      } catch (subscribeError) {
        resyncPending = false;
        toastManager.add({
          type: "error",
          title: "Terminal stream unavailable",
          description:
            subscribeError instanceof Error
              ? subscribeError.message
              : "The terminal stream could not be opened.",
        });
      }
    };
    subscribe();
    const appearanceObserver = new MutationObserver(() => {
      terminal.options.theme = terminalThemeFromApp();
      terminal.options.fontFamily = getTerminalFontFamily();
      terminal.options.fontSize = getTerminalFontSizePx();
      scheduleFit();
    });
    appearanceObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    const webglFrame = window.requestAnimationFrame(() => {
      if (disposed) return;
      try {
        const addon = new WebglAddon();
        addon.onContextLoss(() => {
          addon.dispose();
          if (webglAddon === addon) webglAddon = null;
          terminal.refresh(0, Math.max(0, terminal.rows - 1));
        });
        terminal.loadAddon(addon);
        webglAddon = addon;
      } catch {
        webglAddon = null;
      }
    });
    terminal.focus();

    return () => {
      disposed = true;
      unsubscribe();
      inputQueue.dispose();
      outputPump.dispose();
      resizeObserver.disconnect();
      appearanceObserver.disconnect();
      keyDisposable.dispose();
      inputDisposable.dispose();
      window.cancelAnimationFrame(webglFrame);
      if (resizeFrame !== 0) window.cancelAnimationFrame(resizeFrame);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      if (resubscribeTimer !== null) window.clearTimeout(resubscribeTimer);
      webglAddon?.dispose();
      terminal.dispose();
    };
  }, [active, setViewportSize, threadId]);

  if (!controller || !controller.active || !controller.state) return null;
  const state = controller.state;
  const restarting = controller.busy && canRestartManagedTerminal(state);
  const error = state.error;

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-background-surface)]"
      aria-label={`${managedTerminalProviderLabel(state.provider)} terminal`}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/70 px-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {managedTerminalProviderLabel(state.provider)}
        </span>
        <span aria-live="polite">{managedTerminalStatusLabel(state)}</span>
        {state.model ? <span className="truncate">{state.model}</span> : null}
        <span className="ml-auto">
          Chat composer disabled while Terminal controls this session.
        </span>
        {canRestartManagedTerminal(state) ? (
          <Button
            size="xs"
            variant="outline"
            disabled={controller.busy}
            onClick={() =>
              void controller.restart().catch((restartError: unknown) => {
                toastManager.add({
                  type: "error",
                  title: "Unable to restart Terminal",
                  description:
                    restartError instanceof Error
                      ? restartError.message
                      : "The terminal runtime did not restart.",
                });
              })
            }
          >
            {restarting ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3.5" />
            )}
            Restart
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="outline"
          disabled={
            controller.busy ||
            state.status === "stopping" ||
            state.status === "stopped" ||
            state.status === "exited"
          }
          onClick={() =>
            void controller.stop().catch((stopError: unknown) => {
              toastManager.add({
                type: "error",
                title: "Unable to stop Terminal",
                description:
                  stopError instanceof Error
                    ? stopError.message
                    : "The terminal runtime did not stop.",
              });
            })
          }
        >
          <StopFilledIcon className="size-3.5" />
          Stop
        </Button>
      </div>
      <DisclosureRegion open={Boolean(error)}>
        <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      </DisclosureRegion>
      <div ref={mountRef} className="min-h-0 min-w-0 flex-1 p-2" />
    </section>
  );
}
