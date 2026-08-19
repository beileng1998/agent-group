import { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it } from "vitest";

import { installTerminalInputCompatibility } from "./runtime/terminalInputCompatibility";

describe("terminal input compatibility", () => {
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
    host.style.height = "400px";
    document.body.append(host);
    terminal = new Terminal({ screenReaderMode: false });
    terminal.open(host);
    terminal.focus();
    disposeCompatibility = installTerminalInputCompatibility(terminal, host);
    const textarea = host.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
    if (!textarea) throw new Error("Expected xterm helper textarea.");
    return textarea;
  }

  it("forwards replacement-style voice input through xterm onData exactly once", () => {
    const textarea = openTerminal();
    const received: string[] = [];
    terminal!.onData((data) => received.push(data));

    const event = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: "语音输入",
      inputType: "insertReplacementText",
    });
    textarea.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(received).toEqual(["语音输入"]);
  });

  it("recovers replacement input when an input method emits no beforeinput event", () => {
    const textarea = openTerminal();
    const received: string[] = [];
    terminal!.onData((data) => received.push(data));

    textarea.value = "豆包语音";
    textarea.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: null,
        inputType: "insertReplacementText",
      }),
    );

    expect(received).toEqual(["豆包语音"]);
  });

  it("leaves ordinary insertText input to xterm without duplication", () => {
    const textarea = openTerminal();
    const received: string[] = [];
    terminal!.onData((data) => received.push(data));

    textarea.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: "普通输入",
        inputType: "insertText",
      }),
    );

    expect(received).toEqual(["普通输入"]);
  });
});
