export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function firstStringValue(
  object: Record<string, unknown> | null | undefined,
  keys: readonly string[],
): string | undefined {
  if (!object) {
    return undefined;
  }
  for (const key of keys) {
    const value = asTrimmedString(object[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function pushUniqueThreadId(
  target: string[],
  seen: Set<string>,
  threadId: string | undefined,
): void {
  if (!threadId || seen.has(threadId)) {
    return;
  }
  seen.add(threadId);
  target.push(threadId);
}
