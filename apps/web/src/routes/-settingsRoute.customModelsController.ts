import type { ProviderKind } from "@agent-group/contracts";
import { getModelOptions, normalizeModelSlug } from "@agent-group/shared/model";
import { useCallback, useMemo, useState } from "react";

import {
  type AppSettings,
  CUSTOM_MODEL_EDITOR_PROVIDER_SETTINGS,
  getCustomModelsForProvider,
  MAX_CUSTOM_MODEL_LENGTH,
  patchCustomModels,
} from "../appSettings";

const emptyCustomModelInputs = (): Record<ProviderKind, string> => ({
  codex: "",
  claudeAgent: "",
  cursor: "",
  antigravity: "",
  grok: "",
  droid: "",
  kilo: "",
  opencode: "",
  pi: "",
});

export function useCustomModelsSettingsController(input: {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
}) {
  const [selectedProvider, setSelectedProvider] = useState<ProviderKind>("codex");
  const [inputByProvider, setInputByProvider] = useState(emptyCustomModelInputs);
  const [errorByProvider, setErrorByProvider] = useState<
    Partial<Record<ProviderKind, string | null>>
  >({});
  const [showAll, setShowAll] = useState(false);

  const selectedProviderSettings = CUSTOM_MODEL_EDITOR_PROVIDER_SETTINGS.find(
    (providerSettings) => providerSettings.provider === selectedProvider,
  )!;
  const selectedInput = inputByProvider[selectedProvider];
  const selectedError = errorByProvider[selectedProvider] ?? null;
  const savedRows = useMemo(
    () =>
      CUSTOM_MODEL_EDITOR_PROVIDER_SETTINGS.flatMap((providerSettings) =>
        getCustomModelsForProvider(input.settings, providerSettings.provider).map((slug) => ({
          key: `${providerSettings.provider}:${slug}`,
          provider: providerSettings.provider,
          providerTitle: providerSettings.title,
          slug,
        })),
      ),
    [input.settings],
  );
  const visibleRows = showAll ? savedRows : savedRows.slice(0, 5);

  const setSelectedInput = useCallback(
    (value: string) => {
      setInputByProvider((current) => ({ ...current, [selectedProvider]: value }));
      setErrorByProvider((current) => ({ ...current, [selectedProvider]: null }));
    },
    [selectedProvider],
  );

  const add = useCallback(
    (provider: ProviderKind) => {
      const rawInput = inputByProvider[provider];
      const customModels = getCustomModelsForProvider(input.settings, provider);
      const normalized = normalizeModelSlug(rawInput, provider);
      const setError = (message: string) =>
        setErrorByProvider((current) => ({ ...current, [provider]: message }));
      if (!normalized) {
        setError("Enter a model slug.");
        return;
      }
      if (getModelOptions(provider).some((option) => option.slug === normalized)) {
        setError("That model is already built in.");
        return;
      }
      if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
        setError(`Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`);
        return;
      }
      if (customModels.includes(normalized)) {
        setError("That custom model is already saved.");
        return;
      }

      input.updateSettings(patchCustomModels(provider, [...customModels, normalized]));
      setInputByProvider((current) => ({ ...current, [provider]: "" }));
      setErrorByProvider((current) => ({ ...current, [provider]: null }));
    },
    [input.settings, input.updateSettings, inputByProvider],
  );

  const remove = useCallback(
    (provider: ProviderKind, slug: string) => {
      const customModels = getCustomModelsForProvider(input.settings, provider);
      input.updateSettings(
        patchCustomModels(
          provider,
          customModels.filter((model) => model !== slug),
        ),
      );
      setErrorByProvider((current) => ({ ...current, [provider]: null }));
    },
    [input.settings, input.updateSettings],
  );

  const resetSavedRowsUi = useCallback(() => {
    setErrorByProvider({});
    setShowAll(false);
  }, []);

  const reset = useCallback(() => {
    setSelectedProvider("codex");
    setInputByProvider(emptyCustomModelInputs());
    resetSavedRowsUi();
  }, [resetSavedRowsUi]);

  return {
    selectedProvider,
    setSelectedProvider,
    selectedProviderSettings,
    selectedInput,
    selectedError,
    setSelectedInput,
    savedRows,
    visibleRows,
    showAll,
    setShowAll,
    add,
    remove,
    resetSavedRowsUi,
    reset,
  };
}
