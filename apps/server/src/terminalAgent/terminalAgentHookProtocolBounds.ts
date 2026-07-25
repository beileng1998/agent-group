export const TERMINAL_HOOK_RUNTIME_ID_MAX_CHARS = 128;
export const TERMINAL_HOOK_PROVIDER_VALUE_MAX_CHARS = 512;
export const TERMINAL_HOOK_PATH_MAX_CHARS = 16 * 1024;

export function optionalBoundedHookString(
  value: unknown,
  field: string,
  maxChars = TERMINAL_HOOK_PROVIDER_VALUE_MAX_CHARS,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxChars) {
    throw new Error(`Invalid ${field}: maximum length is ${maxChars} characters.`);
  }
  return trimmed;
}

export function requiredBoundedHookString(
  value: unknown,
  field: string,
  maxChars = TERMINAL_HOOK_PROVIDER_VALUE_MAX_CHARS,
): string {
  const parsed = optionalBoundedHookString(value, field, maxChars);
  if (!parsed) throw new Error(`Invalid ${field}.`);
  return parsed;
}

export function nullableBoundedHookString(
  value: unknown,
  field: string,
  maxChars = TERMINAL_HOOK_PROVIDER_VALUE_MAX_CHARS,
): string | null {
  if (value === null) return null;
  return requiredBoundedHookString(value, field, maxChars);
}
