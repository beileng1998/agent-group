// FILE: piModelRuntime.ts
// Purpose: Adapts Pi's asynchronous ModelRuntime API to Agent Group model discovery and selection.
// Layer: Provider runtime helpers

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

function trimToUndefined(value: string | null | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseModelReference(
  modelId: string | null | undefined,
): { readonly provider?: string; readonly id: string } | undefined {
  const trimmed = trimToUndefined(modelId);
  if (!trimmed) return undefined;

  for (const separator of ["/", ":"] as const) {
    if (!trimmed.includes(separator)) continue;
    const [provider, ...rest] = trimmed.split(separator);
    const id = rest.join(separator);
    if (provider && id) return { provider, id };
  }

  return { id: trimmed };
}

function createProviderModelFallback(
  runtime: Pick<ModelRuntime, "getModels">,
  parsed: { readonly provider: string; readonly id: string },
): Model<Api> | undefined {
  const providerDefault = runtime.getModels(parsed.provider)[0];
  if (!providerDefault) return undefined;

  return {
    id: parsed.id,
    name: parsed.id,
    api: providerDefault.api,
    provider: parsed.provider,
    baseUrl: providerDefault.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
    ...(providerDefault.compat ? { compat: providerDefault.compat } : {}),
  };
}

function findModel(
  runtime: Pick<ModelRuntime, "getModel" | "getModels">,
  modelId: string | null | undefined,
): Model<Api> | undefined {
  const parsed = parseModelReference(modelId);
  if (!parsed) return undefined;

  if (parsed.provider) {
    return (
      runtime.getModel(parsed.provider, parsed.id) ??
      createProviderModelFallback(runtime, { provider: parsed.provider, id: parsed.id })
    );
  }

  return runtime
    .getModels()
    .find((model) => model.id === parsed.id || `${model.provider}/${model.id}` === parsed.id);
}

export async function getPiDiscoverableModels(
  runtime: Pick<ModelRuntime, "getAvailable">,
): Promise<ReadonlyArray<Model<Api>>> {
  return runtime.getAvailable();
}

export async function resolveFreshPiModel(
  runtime: Pick<ModelRuntime, "getModel" | "getModels" | "reloadConfig">,
  modelId: string | null | undefined,
): Promise<Model<Api> | undefined> {
  await runtime.reloadConfig();
  return findModel(runtime, modelId);
}

export function getPiProviderDisplayName(
  runtime: Pick<ModelRuntime, "getProvider">,
  provider: string,
): string {
  return runtime.getProvider(provider)?.name ?? provider;
}
