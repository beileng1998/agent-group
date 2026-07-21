import type {
  AgentGroupConfig,
  AgentGroupContextTemplateId,
  ModelSelection,
} from "@agent-group/contracts";
import { CONTEXT_TEMPLATE_PRESETS } from "@agent-group/shared/contextTemplates";
import { getDefaultModel } from "@agent-group/shared/model";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAppSettings } from "~/appSettings";
import { useGroupSettingsStore } from "~/groupSettingsStore";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";
import { renameAgentGroupProject } from "~/lib/agentGroupProjects";
import { ArrowUpRightIcon, CheckIcon, Loader2Icon } from "~/lib/icons";
import {
  serverConfigQueryOptions,
  serverQueryKeys,
  serverSettingsQueryOptions,
} from "~/lib/serverReactQuery";
import { newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { AgentGroupContextTemplatePicker } from "./AgentGroupContextTemplatePicker";
import { ProviderModelPicker } from "./chat/ProviderModelPicker";
import { SettingsRow, SettingsSection } from "./settings/SettingsPanelPrimitives";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "./ui/sheet";
import { Switch } from "./ui/switch";

type SaveState = "idle" | "saving" | "saved" | "error";

export default function AgentGroupSettingsSheet() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const groupId = useGroupSettingsStore((state) => state.groupId);
  const close = useGroupSettingsStore((state) => state.close);
  const project = useStore((state) =>
    groupId ? state.projects.find((candidate) => candidate.id === groupId) : undefined,
  );
  const syncServerShellSnapshot = useStore((state) => state.syncServerShellSnapshot);
  const { settings } = useAppSettings();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const serverSettingsQuery = useQuery(serverSettingsQueryOptions());
  const canonicalName = project?.remoteName || project?.name || "";
  const globalDefaultAgent = serverSettingsQuery.data?.agentGroup.defaultModelSelection ?? {
    provider: "codex" as const,
    model: getDefaultModel("codex"),
  };
  const defaultAgent = project?.defaultModelSelection ?? globalDefaultAgent;
  const contextTemplates =
    serverSettingsQuery.data?.agentGroup.contextTemplates ?? CONTEXT_TEMPLATE_PRESETS;
  const [config, setConfig] = useState<AgentGroupConfig | null>(null);
  const [groupName, setGroupName] = useState(canonicalName);
  const [groupRules, setGroupRules] = useState("");
  const [contextTemplateId, setContextTemplateId] = useState<AgentGroupContextTemplateId | null>(
    null,
  );
  const [contextAwarenessDefault, setContextAwarenessDefault] = useState(false);
  const [browserAccess, setBrowserAccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configSaveState, setConfigSaveState] = useState<SaveState>("idle");
  const [nameSaveState, setNameSaveState] = useState<SaveState>("idle");
  const [agentSaveState, setAgentSaveState] = useState<SaveState>("idle");
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const loadedGroupId = useRef(groupId);
  const { loadingModelProviders, modelOptionsByProvider } = useProviderModelCatalog({
    selectedProvider: defaultAgent.provider,
    discoveryEnabled: agentPickerOpen,
    cwd: project?.cwd ?? null,
    modelHintByProvider: { [defaultAgent.provider]: defaultAgent.model },
  });

  const loadConfig = useCallback(async () => {
    const api = readNativeApi();
    if (!api || !groupId) return;
    setLoading(true);
    setError(null);
    try {
      const next = await api.agentGroup.getConfig({ groupId });
      setConfig(next);
      setGroupRules(next.globalRules);
      setContextTemplateId(next.contextTemplateId);
      setContextAwarenessDefault(next.contextAwarenessDefaultEnabled);
      setBrowserAccess(next.browserToolsEnabled ?? false);
      setConfigSaveState("idle");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Group settings could not load.");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    if (!groupId) {
      loadedGroupId.current = null;
      return;
    }
    if (loadedGroupId.current === groupId && config) return;
    loadedGroupId.current = groupId;
    setConfig(null);
    setGroupName(canonicalName);
    setNameSaveState("idle");
    setAgentSaveState("idle");
    void loadConfig();
  }, [canonicalName, config, groupId, loadConfig]);

  useEffect(() => {
    if (groupId && !project) close();
  }, [close, groupId, project]);

  const trimmedGroupName = groupName.trim();
  const nameDirty = Boolean(trimmedGroupName && trimmedGroupName !== canonicalName);
  const configDirty = useMemo(
    () =>
      Boolean(
        config &&
        (groupRules !== config.globalRules ||
          contextTemplateId !== config.contextTemplateId ||
          contextAwarenessDefault !== config.contextAwarenessDefaultEnabled ||
          browserAccess !== config.browserToolsEnabled),
      ),
    [browserAccess, config, contextAwarenessDefault, contextTemplateId, groupRules],
  );

  const saveName = useCallback(async () => {
    const api = readNativeApi();
    if (!api || !groupId || !nameDirty) return;
    setNameSaveState("saving");
    setError(null);
    try {
      syncServerShellSnapshot(
        await renameAgentGroupProject({ api, projectId: groupId, title: trimmedGroupName }),
      );
      setNameSaveState("saved");
    } catch (saveError) {
      setNameSaveState("error");
      setError(saveError instanceof Error ? saveError.message : "Group name could not be saved.");
    }
  }, [groupId, nameDirty, syncServerShellSnapshot, trimmedGroupName]);

  const saveDefaultAgent = useCallback(
    async (selection: ModelSelection | null) => {
      const api = readNativeApi();
      if (!api || !project || agentSaveState === "saving") return;
      setAgentSaveState("saving");
      setError(null);
      try {
        await api.orchestration.dispatchCommand({
          type: "project.meta.update",
          commandId: newCommandId(),
          projectId: project.id,
          defaultModelSelection: selection,
        });
        syncServerShellSnapshot(await api.orchestration.getShellSnapshot());
        setAgentSaveState("saved");
      } catch (saveError) {
        setAgentSaveState("error");
        setError(
          saveError instanceof Error ? saveError.message : "Default Agent could not be saved.",
        );
      }
    },
    [agentSaveState, project, syncServerShellSnapshot],
  );

  const saveConfig = useCallback(async () => {
    const api = readNativeApi();
    if (!api || !groupId || !config || !configDirty) return;
    setConfigSaveState("saving");
    setError(null);
    try {
      setConfig(
        await api.agentGroup.updateConfig({
          groupId,
          globalRules: groupRules,
          ...(contextTemplateId !== config.contextTemplateId ? { contextTemplateId } : {}),
          contextAwarenessDefaultEnabled: contextAwarenessDefault,
          browserToolsEnabled: browserAccess,
          expectedRevision: config.revision,
        }),
      );
      await queryClient.invalidateQueries({
        queryKey: serverQueryKeys.agentGroupOverview(groupId),
      });
      setConfigSaveState("saved");
    } catch (saveError) {
      setConfigSaveState("error");
      setError(
        saveError instanceof Error ? saveError.message : "Group configuration could not be saved.",
      );
    }
  }, [
    browserAccess,
    config,
    configDirty,
    contextAwarenessDefault,
    contextTemplateId,
    groupId,
    groupRules,
    queryClient,
  ]);

  const requestClose = useCallback(async () => {
    if (configDirty || nameDirty) {
      const confirmed = await readNativeApi()?.dialogs.confirm("Discard unsaved Group settings?");
      if (!confirmed) return;
    }
    close();
  }, [close, configDirty, nameDirty]);

  const openGlobalPromptSettings = useCallback(async () => {
    if (configDirty || nameDirty) {
      const confirmed = await readNativeApi()?.dialogs.confirm("Discard unsaved Group settings?");
      if (!confirmed) return;
    }
    close();
    await navigate({ to: "/settings", search: { section: "agent-group" } });
  }, [close, configDirty, nameDirty, navigate]);

  return (
    <Sheet open={Boolean(groupId && project)} onOpenChange={(open) => !open && void requestClose()}>
      <SheetPopup side="right" className="w-[min(94vw,680px)] max-w-[680px]" keepMounted>
        <SheetHeader>
          <SheetTitle>Group settings</SheetTitle>
          <SheetDescription>
            {canonicalName}
            {project?.cwd ? (
              <span className="mt-1 block truncate font-mono text-xs">{project.cwd}</span>
            ) : null}
          </SheetDescription>
        </SheetHeader>

        <SheetPanel className="pb-8">
          {loading && !config ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
              <Loader2Icon className="me-2 size-4 animate-spin" /> Loading Group settings
            </div>
          ) : config ? (
            <div className="space-y-6">
              <SettingsSection title="General">
                <SettingsRow
                  title="Group name"
                  description="The name shown in the Group sidebar."
                  status={nameSaveState === "saved" ? <SavedLabel>Saved</SavedLabel> : undefined}
                  control={
                    <div className="flex w-full gap-2 sm:w-72">
                      <Input
                        value={groupName}
                        onChange={(event) => {
                          setGroupName(event.target.value);
                          setNameSaveState("idle");
                        }}
                      />
                      <Button
                        size="sm"
                        disabled={!nameDirty || nameSaveState === "saving"}
                        onClick={() => void saveName()}
                      >
                        Rename
                      </Button>
                    </div>
                  }
                />
                <SettingsRow
                  title="Default Agent"
                  description="New root Sessions use this Agent. Child Sessions inherit their parent."
                  status={
                    project?.defaultModelSelection === null ? (
                      <span>Agent Groups default</span>
                    ) : agentSaveState === "saved" ? (
                      <SavedLabel>Saved</SavedLabel>
                    ) : undefined
                  }
                  control={
                    <div className="flex items-center gap-2">
                      <ProviderModelPicker
                        provider={defaultAgent.provider}
                        model={defaultAgent.model}
                        lockedProvider={null}
                        {...(serverConfigQuery.data?.providers
                          ? { providers: serverConfigQuery.data.providers }
                          : {})}
                        modelOptionsByProvider={modelOptionsByProvider}
                        loadingModelProviders={loadingModelProviders}
                        hiddenProviders={settings.hiddenProviders}
                        providerOrder={settings.providerOrder}
                        disabled={agentSaveState === "saving"}
                        open={agentPickerOpen}
                        onOpenChange={setAgentPickerOpen}
                        onProviderModelChange={(provider, model) =>
                          void saveDefaultAgent({ provider, model })
                        }
                      />
                      {project?.defaultModelSelection ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={agentSaveState === "saving"}
                          onClick={() => void saveDefaultAgent(null)}
                        >
                          Use default
                        </Button>
                      ) : null}
                    </div>
                  }
                />
              </SettingsSection>

              <SettingsSection title="Instructions">
                <SettingsRow
                  title="Group rules"
                  description="Project-specific rules added to every Agent turn in this Group."
                >
                  <textarea
                    className="mt-3 min-h-36 w-full resize-y rounded-lg border border-border bg-background/45 p-3 font-mono text-xs leading-5 outline-none focus:border-foreground/30"
                    value={groupRules}
                    onChange={(event) => {
                      setGroupRules(event.target.value);
                      setConfigSaveState("idle");
                    }}
                    placeholder="Add concise rules for this Group."
                    spellCheck={false}
                  />
                </SettingsRow>
              </SettingsSection>

              <SettingsSection title="Session defaults">
                <div className="px-3 py-3">
                  <AgentGroupContextTemplatePicker
                    templates={contextTemplates}
                    value={contextTemplateId}
                    legacyContent={config.contextTemplate}
                    onChange={(value) => {
                      setContextTemplateId(value);
                      setConfigSaveState("idle");
                    }}
                  />
                </div>
                <SettingsRow
                  title="Awareness by default"
                  description="New Sessions start by following Context changes from other Sessions."
                  control={
                    <Switch
                      checked={contextAwarenessDefault}
                      onCheckedChange={(checked) => {
                        setContextAwarenessDefault(Boolean(checked));
                        setConfigSaveState("idle");
                      }}
                      aria-label="Awareness by default"
                    />
                  }
                />
              </SettingsSection>

              <SettingsSection title="Tools">
                <SettingsRow
                  title="Browser access"
                  description="Allow Agents to browse and interact with pages in an isolated Group browser."
                  control={
                    <Switch
                      checked={browserAccess}
                      onCheckedChange={(checked) => {
                        setBrowserAccess(Boolean(checked));
                        setConfigSaveState("idle");
                      }}
                      aria-label="Browser access"
                    />
                  }
                />
              </SettingsSection>

              <SettingsSection title="Advanced">
                <SettingsRow
                  title="Global prompt architecture"
                  description="Edit the prompt blocks and shared rules used by every Group."
                  control={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void openGlobalPromptSettings()}
                    >
                      Open <ArrowUpRightIcon className="size-3.5" />
                    </Button>
                  }
                />
              </SettingsSection>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {error ?? "Group settings are unavailable."}
              <div className="mt-3">
                <Button variant="outline" size="sm" onClick={() => void loadConfig()}>
                  Retry
                </Button>
              </div>
            </div>
          )}

          {error && config ? (
            <p className="mt-4 rounded-md bg-destructive/8 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </SheetPanel>

        <SheetFooter>
          <Button variant="ghost" onClick={() => void requestClose()}>
            Close
          </Button>
          <Button
            disabled={!configDirty || configSaveState === "saving"}
            onClick={() => void saveConfig()}
          >
            {configSaveState === "saving"
              ? "Saving…"
              : configSaveState === "saved"
                ? "Saved"
                : "Save changes"}
          </Button>
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  );
}

function SavedLabel(props: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <CheckIcon className="size-3 text-emerald-500" /> {props.children}
    </span>
  );
}
