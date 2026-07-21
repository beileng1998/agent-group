// FILE: useAutomationDraftController.ts
// Purpose: Own automation draft review, creation, editing, and submit-time promotion.
// Layer: Web automation controller

import {
  EventId,
  type AutomationDefinition,
  type ModelSelection,
  type ProviderInteractionMode,
  type ProviderStartOptions,
  type RuntimeMode,
  type ThreadId,
} from "@agent-group/contracts";
import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { Project, Thread } from "../types";
import { readNativeApi } from "../nativeApi";
import { prepareAutomationFormForCreate as prepareTargetForm } from "../lib/automationTargetThread";
import {
  acknowledgedRiskIdsForDraft,
  buildAutomationDraftWarnings,
  hasBlockingAutomationDraftWarnings,
  type AutomationDraftWarning,
  type AutomationDraftWarningId,
  warningIdsForAcknowledgedRisks,
} from "../lib/automationDraft";
import { newCommandId, randomUUID } from "../lib/utils";
import { toastManager } from "../components/ui/toast";
import { automationScheduleActivityPayload } from "../components/chat/chatViewSetupAutomation";
import {
  acknowledgedRiskIdsForFormWarnings,
  automationQueryKey,
  buildAutomationFormWarnings,
  createInputFromForm,
  formatCadence,
  formFromDefinition,
  isFormSubmittable,
  providerOptionsForAutomationEdit,
  scheduleFromForm,
  type AutomationFormState,
  updateInputFromForm,
  useAutomations,
} from "../routes/-automations.shared";

interface AssociatedWorktreeMetadata {
  readonly associatedWorktreePath: string | null;
  readonly associatedWorktreeBranch: string | null;
  readonly associatedWorktreeRef: string | null;
}

export interface DraftReviewInput {
  readonly form: AutomationFormState;
  readonly warnings: readonly AutomationDraftWarning[];
  readonly acknowledgedWarningIds: ReadonlySet<AutomationDraftWarningId>;
  readonly warningContext: {
    readonly hasEphemeralContext: boolean;
    readonly generatedConfidence: number | null;
    readonly generatedNeedsConfirmation: boolean;
  };
}

type AutomationWarningContext = DraftReviewInput["warningContext"];

const EMPTY_WARNING_CONTEXT: AutomationWarningContext = {
  hasEphemeralContext: false,
  generatedConfidence: null,
  generatedNeedsConfirmation: false,
} as const;

export function useAutomationDraftController(input: {
  activeProject: Project | null;
  activeProjectId: Project["id"] | null;
  activeThread: Thread | null;
  associatedWorktree: AssociatedWorktreeMetadata;
  projects: readonly Project[];
  routeThreadId: ThreadId;
  isServerThread: boolean;
  threadNotes: string;
  selectedModelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  providerOptionsForDispatch: ProviderStartOptions | undefined;
  clearComposerInput: (threadId: ThreadId) => void;
}) {
  const queryClient = useQueryClient();
  const { data, updateMutation } = useAutomations();
  const [form, setForm] = useState<AutomationFormState | null>(null);
  const [editingDefinition, setEditingDefinition] = useState<AutomationDefinition | null>(null);
  const [warnings, setWarnings] = useState<readonly AutomationDraftWarning[]>([]);
  const [warningContext, setWarningContext] =
    useState<AutomationWarningContext>(EMPTY_WARNING_CONTEXT);
  const [acknowledgedWarningIds, setAcknowledgedWarningIds] = useState<
    ReadonlySet<AutomationDraftWarningId>
  >(() => new Set());
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const reset = useCallback(() => {
    setOpen(false);
    setForm(null);
    setEditingDefinition(null);
    setWarnings([]);
    setWarningContext(EMPTY_WARNING_CONTEXT);
    setAcknowledgedWarningIds(new Set());
  }, []);

  const setDialogOpen = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setEditingDefinition(null);
    }
  }, []);

  const toggleWarning = useCallback((id: AutomationDraftWarningId, checked: boolean) => {
    setAcknowledgedWarningIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const updateForm = useCallback(
    (nextForm: AutomationFormState) => {
      setForm(nextForm);
      setWarnings(
        editingDefinition
          ? buildAutomationFormWarnings(nextForm)
          : buildAutomationDraftWarnings({
              schedule: scheduleFromForm(nextForm),
              mode: nextForm.mode,
              runtimeMode: nextForm.runtimeMode,
              worktreeMode: nextForm.worktreeMode,
              hasEphemeralContext: warningContext.hasEphemeralContext,
              generatedConfidence: warningContext.generatedConfidence,
              generatedNeedsConfirmation: warningContext.generatedNeedsConfirmation,
              prompt: nextForm.prompt,
            }),
      );
    },
    [editingDefinition, warningContext],
  );

  const prepareFormForCreate = useCallback(
    (nextForm: AutomationFormState) =>
      prepareTargetForm({
        form: nextForm,
        api: readNativeApi(),
        activeProject: input.activeProject,
        activeThread: input.activeThread,
        associatedWorktree: input.associatedWorktree,
        isServerThread: input.isServerThread,
        threadNotes: input.threadNotes,
        modelSelection: input.selectedModelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
      }),
    [
      input.activeProject,
      input.activeThread,
      input.associatedWorktree,
      input.interactionMode,
      input.isServerThread,
      input.runtimeMode,
      input.selectedModelSelection,
      input.threadNotes,
    ],
  );

  const createFromForm = useCallback(
    async (request: {
      readonly form: AutomationFormState;
      readonly warnings: readonly AutomationDraftWarning[];
      readonly acknowledgedWarningIds: ReadonlySet<AutomationDraftWarningId>;
      readonly providerOptions?: ProviderStartOptions;
      readonly activityThreadId?: ThreadId | null;
    }): Promise<boolean> => {
      const api = readNativeApi();
      if (!api || !input.activeProject || submittingRef.current) return false;
      if (
        !isFormSubmittable(request.form) ||
        hasBlockingAutomationDraftWarnings(request.warnings, request.acknowledgedWarningIds)
      ) {
        return false;
      }
      const risks = acknowledgedRiskIdsForDraft(request.warnings, request.acknowledgedWarningIds);
      const activityThreadId =
        request.activityThreadId ??
        (input.isServerThread ? (input.activeThread?.id ?? null) : null);
      const createdAt = new Date().toISOString();
      const createInput = createInputFromForm(
        request.form,
        request.providerOptions ?? input.providerOptionsForDispatch,
        risks,
        activityThreadId,
      );
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const definition = await api.automation.create(createInput);
        if (activityThreadId) {
          void api.orchestration
            .dispatchCommand({
              type: "thread.activity.append",
              commandId: newCommandId(),
              threadId: activityThreadId,
              activity: {
                id: EventId.makeUnsafe(randomUUID()),
                tone: "info",
                kind: "automation.created",
                summary: `Created automation: ${definition.name} - ${formatCadence(definition.schedule)}`,
                payload: {
                  source: "chat-composer",
                  automationId: definition.id,
                  automationName: definition.name,
                  mode: definition.mode,
                  cadenceLabel: formatCadence(definition.schedule),
                  schedule: automationScheduleActivityPayload(definition.schedule),
                },
                turnId: null,
                createdAt,
              },
              createdAt,
            })
            .catch(() =>
              toastManager.add({
                type: "warning",
                title: "Thread note not added",
                description:
                  "The automation was created, but Agent Group could not add the activity note.",
              }),
            );
        }
        void queryClient.invalidateQueries({ queryKey: automationQueryKey });
        input.clearComposerInput(input.activeThread?.id ?? input.routeThreadId);
        reset();
        toastManager.add({
          type: "success",
          title: "Automation created",
          description: `${definition.name} - ${formatCadence(definition.schedule)}`,
        });
        return true;
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not create automation",
          description:
            error instanceof Error ? error.message : "Agent Group could not save the automation.",
        });
        return false;
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [input, queryClient, reset],
  );

  const openDraftReview = useCallback((draft: DraftReviewInput) => {
    setEditingDefinition(null);
    setWarningContext(draft.warningContext);
    setForm(draft.form);
    setWarnings(draft.warnings);
    setAcknowledgedWarningIds(draft.acknowledgedWarningIds);
    setOpen(true);
  }, []);

  const openEdit = useCallback(
    (definition: AutomationDefinition) => {
      const nextForm = formFromDefinition(
        definition,
        input.activeProjectId ?? definition.projectId ?? input.projects[0]?.id ?? "",
      );
      setEditingDefinition(definition);
      setWarningContext(EMPTY_WARNING_CONTEXT);
      setForm(nextForm);
      setWarnings(buildAutomationFormWarnings(nextForm));
      setAcknowledgedWarningIds(warningIdsForAcknowledgedRisks(definition.acknowledgedRisks));
      setOpen(true);
    },
    [input.activeProjectId, input.projects],
  );

  const updateFromForm = useCallback(
    async (request: {
      definition: AutomationDefinition;
      form: AutomationFormState;
      warnings: readonly AutomationDraftWarning[];
      acknowledgedWarningIds: ReadonlySet<AutomationDraftWarningId>;
      providerOptions?: ProviderStartOptions;
    }) => {
      if (
        submittingRef.current ||
        !isFormSubmittable(request.form) ||
        hasBlockingAutomationDraftWarnings(request.warnings, request.acknowledgedWarningIds)
      ) {
        return false;
      }
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const providerOptions =
          request.providerOptions ??
          providerOptionsForAutomationEdit(
            request.definition,
            request.form,
            input.providerOptionsForDispatch,
          );
        const updated = await updateMutation.mutateAsync(
          updateInputFromForm(
            request.definition,
            request.form,
            providerOptions,
            acknowledgedRiskIdsForFormWarnings(request.warnings, request.acknowledgedWarningIds),
          ),
        );
        reset();
        toastManager.add({
          type: "success",
          title: "Automation updated",
          description: `${updated.name} - ${formatCadence(updated.schedule)}`,
        });
        return true;
      } catch {
        return false;
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [input.providerOptionsForDispatch, reset, updateMutation],
  );

  const submit = useCallback(async () => {
    if (!form) return;
    if (editingDefinition) {
      await updateFromForm({
        definition: editingDefinition,
        form,
        warnings,
        acknowledgedWarningIds,
      });
      return;
    }
    if (
      !isFormSubmittable(form) ||
      hasBlockingAutomationDraftWarnings(warnings, acknowledgedWarningIds)
    ) {
      return;
    }
    const prepared = await prepareFormForCreate(form);
    if (!prepared) return;
    await createFromForm({
      form: prepared.form,
      warnings,
      acknowledgedWarningIds,
      activityThreadId: prepared.activityThreadId,
    });
  }, [
    acknowledgedWarningIds,
    createFromForm,
    editingDefinition,
    form,
    prepareFormForCreate,
    updateFromForm,
    warnings,
  ]);

  return {
    acknowledgedWarningIds,
    createFromForm,
    data,
    editing: editingDefinition !== null,
    form,
    open,
    openDraftReview,
    openEdit,
    prepareFormForCreate,
    reset,
    setOpen: setDialogOpen,
    submit,
    submitting: submitting || updateMutation.isPending,
    toggleWarning,
    updateForm,
    warnings,
  };
}
