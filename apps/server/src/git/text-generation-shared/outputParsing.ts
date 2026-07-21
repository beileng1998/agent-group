import { Effect, Schema } from "effect";

import { TextGenerationError } from "../Errors.ts";

export function toJsonSchemaObject(schema: Schema.Top): unknown {
  const document = Schema.toJsonSchemaDocument(schema);
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    return {
      ...document.schema,
      $defs: document.definitions,
    };
  }
  return document.schema;
}

export function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  if (start < 0) {
    return trimmed;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(start, index + 1);
      }
    }
  }

  return trimmed.slice(start);
}

// Describes how to recover a single-field result from non-JSON output. `maxWords` rejects
// sentence-length prose so it never masquerades as a short field (e.g. a title or branch),
// letting the caller fall back to its own message-derived default instead.
export interface RawTextFallback {
  readonly key: string;
  readonly maxWords?: number;
}

function stripCodeFences(raw: string): string {
  const fenced = raw.match(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/);
  return (fenced?.[1] ?? raw).trim();
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Prefer the requested field, otherwise the first usable string value, so a wrong-key
// JSON object (e.g. {"name":"Foo"}) yields "Foo" instead of the literal braces.
function pickFallbackString(parsed: Record<string, unknown>, key: string): string | null {
  const preferred = parsed[key];
  if (typeof preferred === "string" && preferred.trim().length > 0) {
    return preferred.trim();
  }
  for (const value of Object.values(parsed)) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function coerceRawTextToFallback(raw: string, fallback: RawTextFallback): string | null {
  const cleaned = stripCodeFences(raw);
  if (cleaned.length === 0) {
    return null;
  }
  const parsed = tryParseJsonObject(cleaned);
  const candidate = parsed ? pickFallbackString(parsed, fallback.key) : cleaned;
  if (candidate === null || candidate.length === 0) {
    return null;
  }
  if (fallback.maxWords !== undefined) {
    const wordCount = candidate.split(/\s+/u).filter((word) => word.length > 0).length;
    if (wordCount > fallback.maxWords) {
      return null;
    }
  }
  return candidate;
}

// Free-text providers (Cursor/OpenCode/Kilo ACP) are only *asked* to emit JSON, unlike Codex
// which enforces `--output-schema`. For single-field prompts (title/branch/summary) they often
// reply with the bare value or surrounding prose, so coerce that raw text into the expected
// single-string field instead of failing the whole generation.
export function decodeStructuredTextGenerationOutput<S extends Schema.Top>(input: {
  readonly schema: S;
  readonly raw: string;
  readonly operation: string;
  readonly providerLabel: string;
  readonly rawTextFallback?: RawTextFallback;
}): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> {
  const decode = Schema.decodeEffect(Schema.fromJsonString(input.schema));
  const toError = (cause: unknown) =>
    new TextGenerationError({
      operation: input.operation,
      detail: `${input.providerLabel} returned invalid structured output.`,
      cause,
    });
  return decode(extractJsonObject(input.raw)).pipe(
    Effect.catchTag("SchemaError", (error) => {
      const fallback = input.rawTextFallback;
      const coerced = fallback ? coerceRawTextToFallback(input.raw, fallback) : null;
      if (!fallback || coerced === null) {
        return Effect.fail(toError(error));
      }
      return decode(JSON.stringify({ [fallback.key]: coerced })).pipe(
        Effect.catchTag("SchemaError", (innerError) => Effect.fail(toError(innerError))),
      );
    }),
  );
}
