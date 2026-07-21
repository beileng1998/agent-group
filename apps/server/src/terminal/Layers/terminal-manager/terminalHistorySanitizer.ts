import {
  AGENT_GROUP_TERMINAL_HOOK_OSC_PREFIX,
  type TerminalAgentHookEventType,
} from "@agent-group/shared/terminalThreads";

function isCsiFinalByte(codePoint: number): boolean {
  return codePoint >= 0x40 && codePoint <= 0x7e;
}

function shouldStripCsiSequence(_body: string, finalByte: string): boolean {
  return finalByte !== "m";
}

function shouldStripOscSequence(content: string): boolean {
  return (
    /^(10|11|12);(?:\?|rgb:)/.test(content) ||
    content.startsWith(AGENT_GROUP_TERMINAL_HOOK_OSC_PREFIX)
  );
}

function extractOscTitle(content: string): string | null {
  return content.match(/^(?:0|2);([\s\S]+)$/)?.[1]?.trim() || null;
}

function extractOscHookEvent(content: string): TerminalAgentHookEventType | null {
  if (!content.startsWith(AGENT_GROUP_TERMINAL_HOOK_OSC_PREFIX)) return null;
  const eventType = content.slice(AGENT_GROUP_TERMINAL_HOOK_OSC_PREFIX.length).trim();
  return eventType === "Start" || eventType === "Stop" || eventType === "PermissionRequest"
    ? eventType
    : null;
}

function stripStringTerminator(value: string): string {
  if (value.endsWith("\u001b\\")) return value.slice(0, -2);
  const last = value.at(-1);
  return last === "\u0007" || last === "\u009c" ? value.slice(0, -1) : value;
}

function findStringTerminatorIndex(input: string, start: number): number | null {
  for (let index = start; index < input.length; index += 1) {
    const codePoint = input.charCodeAt(index);
    if (codePoint === 0x07 || codePoint === 0x9c) return index + 1;
    if (codePoint === 0x1b && input.charCodeAt(index + 1) === 0x5c) return index + 2;
  }
  return null;
}

function isEscapeIntermediateByte(codePoint: number): boolean {
  return codePoint >= 0x20 && codePoint <= 0x2f;
}

function isEscapeFinalByte(codePoint: number): boolean {
  return codePoint >= 0x30 && codePoint <= 0x7e;
}

function findEscapeSequenceEndIndex(input: string, start: number): number | null {
  let cursor = start;
  while (cursor < input.length && isEscapeIntermediateByte(input.charCodeAt(cursor))) {
    cursor += 1;
  }
  if (cursor >= input.length) return null;
  return isEscapeFinalByte(input.charCodeAt(cursor)) ? cursor + 1 : start + 1;
}

export interface SanitizedTerminalHistoryChunk {
  visibleText: string;
  pendingControlSequence: string;
  titleSignals: string[];
  hookEvents: TerminalAgentHookEventType[];
}

export function sanitizeTerminalHistoryChunk(
  pendingControlSequence: string,
  data: string,
): SanitizedTerminalHistoryChunk {
  const input = `${pendingControlSequence}${data}`;
  let visibleText = "";
  let index = 0;
  const titleSignals: string[] = [];
  const hookEvents: TerminalAgentHookEventType[] = [];
  const partial = (from: number): SanitizedTerminalHistoryChunk => ({
    visibleText,
    pendingControlSequence: input.slice(from),
    titleSignals,
    hookEvents,
  });

  while (index < input.length) {
    const codePoint = input.charCodeAt(index);
    if (codePoint === 0x1b) {
      const nextCodePoint = input.charCodeAt(index + 1);
      if (Number.isNaN(nextCodePoint)) return partial(index);

      if (nextCodePoint === 0x5b) {
        let cursor = index + 2;
        while (cursor < input.length) {
          if (isCsiFinalByte(input.charCodeAt(cursor))) {
            const sequence = input.slice(index, cursor + 1);
            const body = input.slice(index + 2, cursor);
            if (!shouldStripCsiSequence(body, input[cursor] ?? "")) visibleText += sequence;
            index = cursor + 1;
            break;
          }
          cursor += 1;
        }
        if (cursor >= input.length) return partial(index);
        continue;
      }

      if ([0x5d, 0x50, 0x5e, 0x5f].includes(nextCodePoint)) {
        const terminatorIndex = findStringTerminatorIndex(input, index + 2);
        if (terminatorIndex === null) return partial(index);
        const sequence = input.slice(index, terminatorIndex);
        const content = stripStringTerminator(input.slice(index + 2, terminatorIndex));
        const hookEvent = extractOscHookEvent(content);
        if (hookEvent) hookEvents.push(hookEvent);
        if (nextCodePoint === 0x5d) {
          const title = extractOscTitle(content);
          if (title) titleSignals.push(title);
        }
        if (nextCodePoint !== 0x5d || !shouldStripOscSequence(content)) visibleText += sequence;
        index = terminatorIndex;
        continue;
      }

      const end = findEscapeSequenceEndIndex(input, index + 1);
      if (end === null) return partial(index);
      const sequence = input.slice(index, end);
      if (sequence !== "\u001b7" && sequence !== "\u001b8") visibleText += sequence;
      index = end;
      continue;
    }

    if (codePoint === 0x9b) {
      let cursor = index + 1;
      while (cursor < input.length) {
        if (isCsiFinalByte(input.charCodeAt(cursor))) {
          const sequence = input.slice(index, cursor + 1);
          const body = input.slice(index + 1, cursor);
          if (!shouldStripCsiSequence(body, input[cursor] ?? "")) visibleText += sequence;
          index = cursor + 1;
          break;
        }
        cursor += 1;
      }
      if (cursor >= input.length) return partial(index);
      continue;
    }

    if ([0x9d, 0x90, 0x9e, 0x9f].includes(codePoint)) {
      const terminatorIndex = findStringTerminatorIndex(input, index + 1);
      if (terminatorIndex === null) return partial(index);
      const sequence = input.slice(index, terminatorIndex);
      const content = stripStringTerminator(input.slice(index + 1, terminatorIndex));
      const hookEvent = extractOscHookEvent(content);
      if (hookEvent) hookEvents.push(hookEvent);
      if (codePoint === 0x9d) {
        const title = extractOscTitle(content);
        if (title) titleSignals.push(title);
      }
      if (codePoint !== 0x9d || !shouldStripOscSequence(content)) visibleText += sequence;
      index = terminatorIndex;
      continue;
    }

    visibleText += input[index] ?? "";
    index += 1;
  }
  return { visibleText, pendingControlSequence: "", titleSignals, hookEvents };
}

export function sanitizePersistedTerminalHistory(history: string): string {
  return history.length === 0 ? history : sanitizeTerminalHistoryChunk("", history).visibleText;
}
