import { Effect, Layer } from "effect";

import { CodexTextGeneration, TextGeneration } from "../Services/TextGeneration.ts";
import { makeCodexTextGenerationOperations } from "./codex-text-generation/codexTextGenerationOperations.ts";
import { makeCodexTextGenerationRuntime } from "./codex-text-generation/codexTextGenerationRunner.ts";

const makeCodexTextGeneration = Effect.gen(function* () {
  const runtime = yield* makeCodexTextGenerationRuntime;
  return makeCodexTextGenerationOperations(runtime);
});

export const CodexTextGenerationServiceLive = Layer.effect(
  CodexTextGeneration,
  makeCodexTextGeneration,
);

export const CodexTextGenerationLive = Layer.effect(TextGeneration, makeCodexTextGeneration);
