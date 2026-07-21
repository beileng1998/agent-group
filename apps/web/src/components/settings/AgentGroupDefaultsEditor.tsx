import type {
  AgentGroupContextTemplate,
  ModelSelection,
  ProviderKind,
} from "@agent-group/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { useAppSettings } from "~/appSettings";
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";
import { PlusIcon, Trash2 } from "~/lib/icons";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import { buildModelSelection } from "~/providerModelOptions";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

export function AgentGroupDefaultsEditor(props: {
  defaultAgent: ModelSelection;
  templates: readonly AgentGroupContextTemplate[];
  onDefaultAgentChange: (selection: ModelSelection) => void;
  onTemplatesChange: (templates: AgentGroupContextTemplate[]) => void;
}) {
  return (
    <div className="space-y-4">
      <SettingsSection title="Defaults">
        <SettingsRow
          title="Default Agent"
          description="Used by Groups that have not selected their own Agent."
          control={
            <DefaultAgentPicker value={props.defaultAgent} onChange={props.onDefaultAgentChange} />
          }
        />
      </SettingsSection>

      <SettingsSection title="Context templates">
        <div className="px-3 py-3">
          <TemplateLibrary templates={props.templates} onChange={props.onTemplatesChange} />
        </div>
      </SettingsSection>
    </div>
  );
}

function DefaultAgentPicker(props: {
  value: ModelSelection;
  onChange: (selection: ModelSelection) => void;
}) {
  const { settings } = useAppSettings();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const [open, setOpen] = useState(false);
  const modelHintByProvider = useMemo<Partial<Record<ProviderKind, string | null>>>(
    () => ({ [props.value.provider]: props.value.model }),
    [props.value.model, props.value.provider],
  );
  const { loadingModelProviders, modelOptionsByProvider } = useProviderModelCatalog({
    selectedProvider: props.value.provider,
    discoveryEnabled: open,
    cwd: serverConfigQuery.data?.cwd ?? null,
    modelHintByProvider,
  });

  return (
    <ProviderModelPicker
      compact
      provider={props.value.provider}
      model={props.value.model}
      lockedProvider={null}
      {...(serverConfigQuery.data?.providers
        ? { providers: serverConfigQuery.data.providers }
        : {})}
      modelOptionsByProvider={modelOptionsByProvider}
      loadingModelProviders={loadingModelProviders}
      hiddenProviders={settings.hiddenProviders}
      providerOrder={settings.providerOrder}
      open={open}
      onOpenChange={setOpen}
      onProviderModelChange={(provider, model) =>
        props.onChange(buildModelSelection(provider, model))
      }
    />
  );
}

function TemplateLibrary(props: {
  templates: readonly AgentGroupContextTemplate[];
  onChange: (templates: AgentGroupContextTemplate[]) => void;
}) {
  const [selectedId, setSelectedId] = useState(props.templates[0]?.id ?? null);
  const selected =
    props.templates.find((template) => template.id === selectedId) ?? props.templates[0] ?? null;

  useEffect(() => {
    if (!selected && props.templates[0]) setSelectedId(props.templates[0].id);
  }, [props.templates, selected]);

  const updateSelected = (patch: Partial<AgentGroupContextTemplate>) => {
    if (!selected) return;
    props.onChange(
      props.templates.map((template) =>
        template.id === selected.id ? { ...template, ...patch } : template,
      ),
    );
  };

  const addTemplate = () => {
    const template: AgentGroupContextTemplate = {
      id: `custom-${crypto.randomUUID()}`,
      name: "Untitled",
      description: "Custom Session context structure",
      content: "# Context\n",
    };
    props.onChange([...props.templates, template]);
    setSelectedId(template.id);
  };

  const removeSelected = () => {
    if (!selected || props.templates.length <= 1) return;
    const next = props.templates.filter((template) => template.id !== selected.id);
    props.onChange(next);
    setSelectedId(next[0]?.id ?? null);
  };

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium">Template library</div>
          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
            Groups select from this shared library. Existing Context files stay unchanged.
          </p>
        </div>
        <Button size="xs" variant="outline" onClick={addTemplate}>
          <PlusIcon className="size-3.5" /> Add template
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
        <div className="space-y-1 rounded-lg border border-border bg-background/25 p-1.5">
          {props.templates.map((template) => (
            <button
              key={template.id}
              type="button"
              className={cn(
                "w-full rounded-md px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted/55 focus-visible:ring-2 focus-visible:ring-ring/60",
                selected?.id === template.id && "bg-muted text-foreground",
              )}
              onClick={() => setSelectedId(template.id)}
            >
              <span className="block truncate text-xs font-medium">{template.name}</span>
              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                {template.description || "No description"}
              </span>
            </button>
          ))}
        </div>

        {selected ? (
          <div className="space-y-3 rounded-lg border border-border bg-background/25 p-3">
            <div className="flex items-center gap-2">
              <Input
                aria-label="Template name"
                value={selected.name}
                onChange={(event) => updateSelected({ name: event.target.value })}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={props.templates.length <= 1}
                aria-label={`Delete ${selected.name}`}
                title={
                  props.templates.length <= 1 ? "Keep at least one template" : "Delete template"
                }
                onClick={removeSelected}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <Input
              aria-label="Template description"
              value={selected.description}
              placeholder="Short description"
              onChange={(event) => updateSelected({ description: event.target.value })}
            />
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">
                Markdown body
              </span>
              <textarea
                className="h-56 w-full resize-y rounded-lg border border-border bg-background/50 p-3 font-mono text-xs leading-5 outline-none focus:border-foreground/30"
                value={selected.content}
                onChange={(event) => updateSelected({ content: event.target.value })}
                spellCheck={false}
              />
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );
}
