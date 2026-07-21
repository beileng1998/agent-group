import { Schema } from "effect";

import type { BranchNameGenerationInput } from "../../Services/TextGeneration.ts";
import { TextGenerationError } from "../../Errors.ts";

export const CODEX_REASONING_EFFORT = "low";
export const CODEX_TIMEOUT_MS = 180_000;

export function normalizeCodexError(
  binaryPath: string,
  operation: string,
  error: unknown,
  fallback: string,
): TextGenerationError {
  if (Schema.is(TextGenerationError)(error)) {
    return error;
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes(`Command not found: ${binaryPath}`) ||
      lower.includes(`spawn ${binaryPath.toLowerCase()}`) ||
      lower.includes("enoent")
    ) {
      return new TextGenerationError({
        operation,
        detail: `Codex CLI (${binaryPath}) is required but not available.`,
        cause: error,
      });
    }
    return new TextGenerationError({
      operation,
      detail: `${fallback}: ${error.message}`,
      cause: error,
    });
  }

  return new TextGenerationError({
    operation,
    detail: fallback,
    cause: error,
  });
}

export function sanitizeCodexConfigForTextGeneration(content: string): string {
  const lines = content.split(/\r?\n/g);
  const sanitized: string[] = [];
  let skippingSkillsConfig = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("[[")) {
      if (trimmed === "[[skills.config]]") {
        skippingSkillsConfig = true;
        continue;
      }

      skippingSkillsConfig = false;
      sanitized.push(line);
      continue;
    }

    if (trimmed.startsWith("[")) {
      skippingSkillsConfig = false;
      sanitized.push(line);
      continue;
    }

    if (!skippingSkillsConfig) {
      sanitized.push(line);
    }
  }

  return sanitized.join("\n").trimEnd();
}

export function resolveCodexBinaryPath(
  providerOptions: BranchNameGenerationInput["providerOptions"] | undefined,
): string {
  return providerOptions?.codex?.binaryPath?.trim() || "codex";
}

export function resolveCodexHomePath(
  codexHomePath: string | undefined,
  providerOptions: BranchNameGenerationInput["providerOptions"] | undefined,
): string | undefined {
  const resolved = codexHomePath?.trim() || providerOptions?.codex?.homePath?.trim();
  return resolved && resolved.length > 0 ? resolved : undefined;
}

export function resolveCodexModel(
  model: string | undefined,
  modelSelection: BranchNameGenerationInput["modelSelection"] | undefined,
): string | undefined {
  if (modelSelection?.provider === "codex") {
    return modelSelection.model;
  }
  return model;
}
