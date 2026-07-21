// FILE: AutomationModelPicker.tsx
// Purpose: Resolves provider discovery and renders the automation model picker.
// Layer: Automation web feature

import type { ModelSelection, ProviderKind } from "@agent-group/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useAppSettings } from "~/appSettings";
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";
import { useProviderStatusesForLocalConfig } from "~/hooks/useProviderStatusesForLocalConfig";
import { resolveProviderDiscoveryCwd } from "~/lib/providerDiscovery";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { buildModelSelection } from "~/providerModelOptions";

export function AutomationModelPicker({
  value,
  projectCwd,
  onChange,
}: {
  readonly value: ModelSelection;
  readonly projectCwd: string | null;
  readonly onChange: (value: ModelSelection) => void;
}) {
  const { settings } = useAppSettings();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const providerStatuses = useProviderStatusesForLocalConfig();
  const [open, setOpen] = useState(false);
  const modelHintByProvider = useMemo<Partial<Record<ProviderKind, string | null>>>(
    () => ({ [value.provider]: value.model }),
    [value.model, value.provider],
  );
  const providerModelDiscoveryCwd = resolveProviderDiscoveryCwd({
    activeThreadWorktreePath: null,
    activeProjectCwd: projectCwd,
    serverCwd: serverConfigQuery.data?.cwd ?? null,
  });
  const { modelOptionsByProvider, loadingModelProviders } = useProviderModelCatalog({
    selectedProvider: value.provider,
    discoveryEnabled: open,
    cwd: providerModelDiscoveryCwd,
    modelHintByProvider,
  });

  return (
    <ProviderModelPicker
      compact
      provider={value.provider}
      model={value.model}
      lockedProvider={null}
      providers={providerStatuses}
      modelOptionsByProvider={modelOptionsByProvider}
      loadingModelProviders={loadingModelProviders}
      hiddenProviders={settings.hiddenProviders}
      providerOrder={settings.providerOrder}
      open={open}
      onOpenChange={setOpen}
      onProviderModelChange={(provider, model) => onChange(buildModelSelection(provider, model))}
    />
  );
}
