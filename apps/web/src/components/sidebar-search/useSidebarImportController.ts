import { useEffect, useState } from "react";
import { importDescription, importFieldLabel, importPlaceholder } from "./sidebarSearchReadModel";
import type { ImportProviderKind } from "./sidebarSearchTypes";

interface UseSidebarImportControllerInput {
  importProviders: readonly ImportProviderKind[];
  onImportThread: (provider: ImportProviderKind, externalId: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function useSidebarImportController(input: UseSidebarImportControllerInput) {
  const [provider, setProvider] = useState<ImportProviderKind>(input.importProviders[0] ?? "codex");
  const [id, setId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (!input.open) {
      setProvider(input.importProviders[0] ?? "codex");
      setId("");
      setError(null);
      setIsImporting(false);
    }
  }, [input.importProviders, input.open]);

  useEffect(() => {
    if (input.importProviders.includes(provider)) return;
    setProvider(input.importProviders[0] ?? "codex");
  }, [input.importProviders, provider]);

  const submit = async () => {
    const normalizedImportId = id.trim();
    if (!normalizedImportId || isImporting) return;
    setError(null);
    setIsImporting(true);
    try {
      await input.onImportThread(provider, normalizedImportId);
      input.onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to import thread.");
    } finally {
      setIsImporting(false);
    }
  };

  return {
    description: importDescription(provider),
    error,
    fieldLabel: importFieldLabel(provider),
    id,
    isImporting,
    placeholder: importPlaceholder(provider),
    provider,
    resetError: () => setError(null),
    setId,
    setProvider,
    submit,
  };
}

export type SidebarImportController = ReturnType<typeof useSidebarImportController>;
