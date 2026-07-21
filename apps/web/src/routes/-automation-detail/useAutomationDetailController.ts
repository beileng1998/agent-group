import {
  type AutomationRun,
  type AutomationUpdateInput,
  type AutomationWorktreeMode,
  type ModelSelection,
} from "@agent-group/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { getProviderStartOptions, useAppSettings } from "~/appSettings";
import {
  automationApprovalGaps,
  hasBlockingAutomationDraftWarnings,
  warningIdsForAcknowledgedRisks,
  type AutomationDraftWarning,
  type AutomationDraftWarningId,
} from "~/lib/automationDraft";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";

import {
  acknowledgedRiskIdsForFormWarnings,
  buildAutomationFormWarnings,
  formFromDefinition,
  isFormSubmittable,
  providerOptionsForAutomationEdit,
  providerOptionsForAutomationModelSelection,
  type AutomationFormState,
  updateInputFromForm,
  useAutomations,
} from "../-automations.shared";
import { automationStatusDisplay, lastFinishedRun } from "./automationDetailValues";

export function useAutomationDetailController(automationId: string) {
  const navigate = useNavigate();
  const { settings } = useAppSettings();
  const projects = useStore((state) => state.projects);
  const threads = useStore((state) => state.threads);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<AutomationFormState | null>(null);
  const [dialogWarnings, setDialogWarnings] = useState<readonly AutomationDraftWarning[]>([]);
  const [acknowledgedWarningIds, setAcknowledgedWarningIds] = useState<
    ReadonlySet<AutomationDraftWarningId>
  >(() => new Set());
  const automations = useAutomations();
  const definition =
    automations.data.definitions.find((candidate) => candidate.id === automationId) ?? null;
  const runs = useMemo(
    () => automations.runsByAutomationId.get(automationId) ?? [],
    [automations.runsByAutomationId, automationId],
  );
  const providerOptionsForDispatch = useMemo(() => getProviderStartOptions(settings), [settings]);
  const navigateToAutomations = () => void navigate({ to: "/automations" });

  if (!definition) {
    return { kind: "missing" as const, navigateToAutomations };
  }

  const project = projects.find((candidate) => candidate.id === definition.projectId);
  const targetThread = threads.find((candidate) => candidate.id === definition.targetThreadId);
  const sourceThread = definition.sourceThreadId
    ? threads.find((candidate) => candidate.id === definition.sourceThreadId)
    : null;
  const approvalGaps = automationApprovalGaps({
    schedule: definition.schedule,
    enabled: definition.enabled,
    maxIterations: definition.maxIterations,
    mode: definition.mode,
    runtimeMode: definition.runtimeMode,
    worktreeMode: definition.worktreeMode,
    prompt: definition.prompt,
    acknowledgedRisks: definition.acknowledgedRisks,
  });
  const patch = (input: Omit<AutomationUpdateInput, "id">) =>
    automations.updateMutation.mutate({ id: definition.id, ...input });
  const approveAutomationRisks = () =>
    automations.updateMutation.mutateAsync({
      id: definition.id,
      acknowledgedRisks: approvalGaps.acknowledgedRisks,
      ...(approvalGaps.maxIterations !== undefined
        ? { maxIterations: approvalGaps.maxIterations }
        : {}),
    });
  const approveAndRunNow = async () => {
    try {
      await approveAutomationRisks();
    } catch {
      return;
    }
    automations.runNowMutation.mutate(definition);
  };
  const applyModelSelection = (nextModelSelection: ModelSelection) => {
    const providerOptions = providerOptionsForAutomationModelSelection(
      definition,
      nextModelSelection,
      providerOptionsForDispatch,
    );
    patch({
      modelSelection: nextModelSelection,
      ...(providerOptions ? { providerOptions } : {}),
    });
  };
  const openEditDialog = (overrides: Partial<AutomationFormState> = {}) => {
    const nextForm = {
      ...formFromDefinition(definition, project?.id ?? projects[0]?.id ?? ""),
      ...overrides,
    };
    setForm(nextForm);
    setDialogWarnings(buildAutomationFormWarnings(nextForm));
    setAcknowledgedWarningIds(warningIdsForAcknowledgedRisks(definition.acknowledgedRisks));
    setDialogOpen(true);
  };
  const updateDialogForm = (nextForm: AutomationFormState) => {
    setForm(nextForm);
    setDialogWarnings(buildAutomationFormWarnings(nextForm));
  };
  const toggleWarning = (id: AutomationDraftWarningId, checked: boolean) => {
    setAcknowledgedWarningIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const submitForm = () => {
    if (!form || !isFormSubmittable(form)) return;
    if (hasBlockingAutomationDraftWarnings(dialogWarnings, acknowledgedWarningIds)) return;
    const acknowledgedRisks = acknowledgedRiskIdsForFormWarnings(
      dialogWarnings,
      acknowledgedWarningIds,
    );
    automations.updateMutation.mutate(
      updateInputFromForm(
        definition,
        form,
        providerOptionsForAutomationEdit(definition, form, providerOptionsForDispatch),
        acknowledgedRisks,
      ),
      { onSuccess: () => setDialogOpen(false) },
    );
  };
  const deleteDefinition = async () => {
    const confirmed = await ensureNativeApi().dialogs.confirm(`Delete "${definition.name}"?`);
    if (!confirmed) return;
    automations.deleteMutation.mutate(definition, { onSuccess: navigateToAutomations });
  };
  const navigateToThread = (threadId: NonNullable<AutomationRun["threadId"]>) =>
    void navigate({ to: "/$threadId", params: { threadId } });

  return {
    kind: "loaded" as const,
    definition,
    projects,
    threads,
    project,
    targetThread,
    sourceThread,
    runs,
    lastRun: lastFinishedRun(runs),
    status: automationStatusDisplay(definition),
    approvalGaps,
    approvalBusy: automations.updateMutation.isPending || automations.runNowMutation.isPending,
    updatePending: automations.updateMutation.isPending,
    runNowPending: automations.runNowMutation.isPending,
    dialog: {
      open: dialogOpen,
      form,
      warnings: dialogWarnings,
      acknowledgedWarningIds,
      setOpen: setDialogOpen,
      updateForm: updateDialogForm,
      toggleWarning,
      submit: submitForm,
    },
    patch,
    applyModelSelection,
    openEditDialog,
    togglePause: () =>
      automations.updateMutation.mutate({ id: definition.id, enabled: !definition.enabled }),
    deleteDefinition,
    runNow: () => automations.runNowMutation.mutate(definition),
    approve: approveAutomationRisks,
    approveAndRunNow,
    cancelRun: (run: AutomationRun) => automations.cancelRunMutation.mutate(run),
    markRunRead: (run: AutomationRun, unread: boolean) =>
      automations.markRunReadMutation.mutate({ run, unread }),
    archiveRun: (run: AutomationRun, archived: boolean) =>
      automations.archiveRunMutation.mutate({ run, archived }),
    navigateToAutomations,
    navigateToThread,
    setWorktreeMode: (value: AutomationWorktreeMode) => {
      if (
        (value === "local" || value === "auto") &&
        !definition.acknowledgedRisks.includes("local-checkout")
      ) {
        openEditDialog({ worktreeMode: value });
        return;
      }
      patch({ worktreeMode: value });
    },
  };
}

export type LoadedAutomationDetailController = Extract<
  ReturnType<typeof useAutomationDetailController>,
  { readonly kind: "loaded" }
>;
