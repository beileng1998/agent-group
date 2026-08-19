import { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it } from "vitest";

import { installTerminalScrollCompatibility } from "./runtime/terminalScrollCompatibility";

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

describe("terminal scroll compatibility", () => {
  let terminal: Terminal | null = null;
  let host: HTMLDivElement | null = null;
  let disposeCompatibility = () => {};

  afterEach(() => {
    disposeCompatibility();
    terminal?.dispose();
    host?.remove();
    disposeCompatibility = () => {};
    terminal = null;
    host = null;
  });

  function openTerminal() {
    host = document.createElement("div");
    host.style.width = "800px";
    host.style.height = "420px";
    document.body.append(host);
    terminal = new Terminal({ cols: 80, rows: 24, scrollSensitivity: 1 });
    terminal.open(host);
    disposeCompatibility = installTerminalScrollCompatibility(terminal);
    return terminal;
  }

  function dispatchWheel(lines: number): WheelEvent {
    const screen = terminal!.element!.querySelector<HTMLElement>(".xterm-screen")!;
    const rect = screen.getBoundingClientRect();
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaY: (rect.height / terminal!.rows) * lines,
    });
    terminal!.element!.dispatchEvent(event);
    return event;
  }

  it("sends one cursor sequence for every line in the alternate buffer", async () => {
    const xterm = openTerminal();
    const received: string[] = [];
    xterm.onData((data) => received.push(data));
    await write(xterm, "\x1b[?1049h");

    const event = dispatchWheel(3.1);

    expect(event.defaultPrevented).toBe(true);
    expect(received.join("")).toBe("\x1b[B\x1b[B\x1b[B");
  });

  it("sends the full wheel magnitude to an SGR mouse-tracking TUI", async () => {
    const xterm = openTerminal();
    const received: string[] = [];
    xterm.onData((data) => received.push(data));
    await write(xterm, "\x1b[?1000h\x1b[?1006h");

    const event = dispatchWheel(-2.1);
    const reports = received.join("").match(/\x1b\[<64;\d+;\d+M/g);

    expect(event.defaultPrevented).toBe(true);
    expect(reports).toHaveLength(2);
  });
});
