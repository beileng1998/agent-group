import {
  DEFAULT_SERVER_SETTINGS,
  type AgentGroupServerSettings,
  type ServerSettings,
} from "@agent-group/contracts";
import { agentGroupPromptInstructionsEqual } from "@agent-group/shared/agentGroupPrompt";
import { CONTEXT_TEMPLATE_PRESETS } from "@agent-group/shared/contextTemplates";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { AgentGroupPromptBuilder } from "~/components/AgentGroupPromptBuilder";
import { AgentGroupDefaultsEditor } from "./AgentGroupDefaultsEditor";
import { Button } from "~/components/ui/button";
import { Loader2Icon, RotateCcwIcon } from "~/lib/icons";
import { serverQueryKeys, serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";

type SaveState = "idle" | "saving" | "saved" | "error";

const DEFAULT_AGENT_GROUP_SETTINGS: AgentGroupServerSettings = {
  ...DEFAULT_SERVER_SETTINGS.agentGroup,
  contextTemplates: CONTEXT_TEMPLATE_PRESETS.map((template) => ({ ...template })),
};

export function AgentGroupSettingsPanel() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(serverSettingsQueryOptions());
  const [draft, setDraft] = useState<AgentGroupServerSettings>(
    DEFAULT_AGENT_GROUP_SETTINGS,
  );
  const [saved, setSaved] = useState<AgentGroupServerSettings>(
    DEFAULT_AGENT_GROUP_SETTINGS,
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settingsQuery.data) return;
    setDraft(settingsQuery.data.agentGroup);
    setSaved(settingsQuery.data.agentGroup);
    setSaveState("idle");
  }, [settingsQuery.data]);

  const dirty = useMemo(() => !agentGroupSettingsEqual(draft, saved), [draft, saved]);

  const save = async () => {
    if (!dirty || saveState === "saving") return;
    setSaveState("saving");
    setError(null);
    try {
      const next = await ensureNativeApi().server.updateSettings({ agentGroup: draft });
      queryClient.setQueryData<ServerSettings>(serverQueryKeys.settings(), next);
      setDraft(next.agentGroup);
      setSaved(next.agentGroup);
      setSaveState("saved");
    } catch (saveError) {
      setSaveState("error");
      setError(
        saveError instanceof Error ? saveError.message : "Agent Group settings could not be saved.",
      );
    }
  };

  if (settingsQuery.isLoading && !settingsQuery.data) {
    return (
      <div className="flex min-h-40 items-center justify-center text-xs text-muted-foreground">
        <Loader2Icon className="me-2 size-3.5 animate-spin" /> Loading Agent Group settings
      </div>
    );
  }

  if (settingsQuery.isError && !settingsQuery.data) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">Agent Group settings could not load.</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => settingsQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AgentGroupDefaultsEditor
        defaultAgent={draft.defaultModelSelection}
        templates={draft.contextTemplates}
        onDefaultAgentChange={(defaultModelSelection) => {
          setDraft((current) => ({ ...current, defaultModelSelection }));
          setSaveState("idle");
        }}
        onTemplatesChange={(contextTemplates) => {
          setDraft((current) => ({ ...current, contextTemplates }));
          setSaveState("idle");
        }}
      />

      <AgentGroupPromptBuilder
        contextEnabled={draft.contextEnabled}
        globalRules={draft.globalRules}
        promptInstructions={draft.promptInstructions}
        onContextEnabledChange={(contextEnabled) => {
          setDraft((current) => ({ ...current, contextEnabled }));
          setSaveState("idle");
        }}
        onGlobalRulesChange={(globalRules) => {
          setDraft((current) => ({ ...current, globalRules }));
          setSaveState("idle");
        }}
        onPromptInstructionsChange={(promptInstructions) => {
          setDraft((current) => ({ ...current, promptInstructions }));
          setSaveState("idle");
        }}
      />

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <Button
          size="sm"
          variant="ghost"
          disabled={agentGroupSettingsEqual(draft, DEFAULT_AGENT_GROUP_SETTINGS)}
          onClick={() => {
            setDraft(DEFAULT_AGENT_GROUP_SETTINGS);
            setSaveState("idle");
          }}
        >
          <RotateCcwIcon className="size-3.5" /> Restore defaults
        </Button>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground">
            {saveState === "saved" ? "Settings saved" : "Applies to every Group."}
          </span>
          <Button size="sm" disabled={!dirty || saveState === "saving"} onClick={() => void save()}>
            {saveState === "saving" ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-md bg-destructive/8 px-3 py-2 text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

function agentGroupSettingsEqual(
  left: AgentGroupServerSettings,
  right: AgentGroupServerSettings,
): boolean {
  return (
    left.contextEnabled === right.contextEnabled &&
    JSON.stringify(left.defaultModelSelection) === JSON.stringify(right.defaultModelSelection) &&
    JSON.stringify(left.contextTemplates) === JSON.stringify(right.contextTemplates) &&
    left.globalRules === right.globalRules &&
    agentGroupPromptInstructionsEqual(left.promptInstructions, right.promptInstructions)
  );
}
