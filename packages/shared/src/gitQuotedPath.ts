// FILE: gitQuotedPath.ts
// Purpose: Decode Git's C-style quoted UTF-8 paths without touching ordinary paths.
// Layer: Shared runtime utility

const OCTAL_BYTE_PATTERN = /^[0-3][0-7]{2}$/u;
const HIGH_OCTAL_BYTE_PATTERN = /\\[2-3][0-7]{2}/u;
const NON_ASCII_PATTERN = /[^\x00-\x7f]/u;

const SIMPLE_ESCAPE_BYTES: Readonly<Record<string, number>> = {
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  '"': 0x22,
  "\\": 0x5c,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function appendText(bytes: number[], value: string): void {
  bytes.push(...encoder.encode(value));
}

export function decodeGitQuotedPath(value: string): string {
  const wrapped = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
  const body = wrapped ? value.slice(1, -1) : value;
  if (!wrapped && !HIGH_OCTAL_BYTE_PATTERN.test(body)) return value;

  const bytes: number[] = [];
  for (let index = 0; index < body.length; ) {
    const character = body[index]!;
    if (character !== "\\") {
      const codePoint = body.codePointAt(index)!;
      const literal = String.fromCodePoint(codePoint);
      appendText(bytes, literal);
      index += literal.length;
      continue;
    }

    const octal = body.slice(index + 1, index + 4);
    if (OCTAL_BYTE_PATTERN.test(octal)) {
      bytes.push(Number.parseInt(octal, 8));
      index += 4;
      continue;
    }

    const escaped = body[index + 1];
    const simpleByte = escaped === undefined ? undefined : SIMPLE_ESCAPE_BYTES[escaped];
    if (simpleByte !== undefined) {
      bytes.push(simpleByte);
      index += 2;
      continue;
    }

    appendText(bytes, "\\");
    index += 1;
  }

  try {
    const decoded = decoder.decode(Uint8Array.from(bytes));
    return wrapped || NON_ASCII_PATTERN.test(decoded) ? decoded : value;
  } catch {
    return value;
  }
}
