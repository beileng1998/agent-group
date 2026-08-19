import type { Terminal } from "@xterm/xterm";

const BRIDGED_INPUT_TYPES = new Set(["insertReplacementText", "insertFromDictation"]);

function insertedTextFromValueChange(previousValue: string, nextValue: string): string {
  let prefixLength = 0;
  const sharedLength = Math.min(previousValue.length, nextValue.length);
  while (
    prefixLength < sharedLength &&
    previousValue.charCodeAt(prefixLength) === nextValue.charCodeAt(prefixLength)
  ) {
    prefixLength += 1;
  }

  let previousSuffix = previousValue.length;
  let nextSuffix = nextValue.length;
  while (
    previousSuffix > prefixLength &&
    nextSuffix > prefixLength &&
    previousValue.charCodeAt(previousSuffix - 1) === nextValue.charCodeAt(nextSuffix - 1)
  ) {
    previousSuffix -= 1;
    nextSuffix -= 1;
  }
  return nextValue.slice(prefixLength, nextSuffix);
}

function shouldBridgeInput(event: InputEvent): boolean {
  return BRIDGED_INPUT_TYPES.has(event.inputType);
}

/**
 * Complements xterm's hidden textarea for voice/dictation tools that commit
 * replacement input without a composition sequence. Data still enters through
 * Terminal.input so every existing onData queue and runtime fence remains in force.
 */
export function installTerminalInputCompatibility(
  terminal: Terminal,
  container: HTMLElement,
): () => void {
  const textarea = container.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
  if (!textarea) return () => {};

  let previousValue = textarea.value;
  let composing = false;
  let compositionSettling = false;
  let handledBeforeInput = false;
  let compositionTimer: number | null = null;

  const onCompositionStart = () => {
    composing = true;
    compositionSettling = false;
    if (compositionTimer !== null) window.clearTimeout(compositionTimer);
    compositionTimer = null;
  };
  const onCompositionEnd = () => {
    composing = false;
    compositionSettling = true;
    compositionTimer = window.setTimeout(() => {
      compositionTimer = null;
      compositionSettling = false;
      previousValue = textarea.value;
    }, 0);
  };
  const onBeforeInput = (event: InputEvent) => {
    previousValue = textarea.value;
    if (
      composing ||
      compositionSettling ||
      event.isComposing ||
      !shouldBridgeInput(event) ||
      !event.cancelable ||
      !event.data
    ) {
      return;
    }

    handledBeforeInput = true;
    event.preventDefault();
    terminal.input(event.data, true);
    queueMicrotask(() => {
      handledBeforeInput = false;
    });
  };
  const onInput = (event: Event) => {
    const inputEvent = event as InputEvent;
    const nextValue = textarea.value;
    const valueBeforeInput = previousValue;
    previousValue = nextValue;
    if (
      handledBeforeInput ||
      composing ||
      compositionSettling ||
      inputEvent.isComposing ||
      !shouldBridgeInput(inputEvent)
    ) {
      return;
    }

    const insertedText =
      inputEvent.data || insertedTextFromValueChange(valueBeforeInput, nextValue);
    if (insertedText) terminal.input(insertedText, true);
  };

  textarea.addEventListener("compositionstart", onCompositionStart);
  textarea.addEventListener("compositionend", onCompositionEnd);
  textarea.addEventListener("beforeinput", onBeforeInput);
  textarea.addEventListener("input", onInput);

  return () => {
    if (compositionTimer !== null) window.clearTimeout(compositionTimer);
    textarea.removeEventListener("compositionstart", onCompositionStart);
    textarea.removeEventListener("compositionend", onCompositionEnd);
    textarea.removeEventListener("beforeinput", onBeforeInput);
    textarea.removeEventListener("input", onInput);
  };
}
