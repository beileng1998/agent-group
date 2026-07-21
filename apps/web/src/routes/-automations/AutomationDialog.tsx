// FILE: AutomationDialog.tsx
// Purpose: Owns the automation draft dialog shell and validation presentation.
// Layer: Automation web feature

import { ComposerPickerMenuPopup } from "~/components/chat/ComposerPickerMenuPopup";
import { Button } from "~/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Menu, MenuItem, MenuTrigger } from "~/components/ui/menu";
import {
  hasBlockingAutomationDraftWarnings,
  type AutomationDraftWarning,
  type AutomationDraftWarningId,
} from "~/lib/automationDraft";
import {
  automationFastIntervalLimitMessage,
  isFormSubmittable,
  modelSelectionForProjectChange,
  type AutomationFormState,
} from "~/lib/automationForm";
import { CentralIcon } from "~/lib/central-icons";
import { useStore } from "~/store";
import { AutomationDialogToolbar } from "./AutomationDialogToolbar";
import type { SetAutomationFormField } from "./automationDialogTypes";
import { AUTOMATION_TEMPLATES } from "./automationPresentation";

export function AutomationDialog({
  open,
  editing,
  form,
  projects,
  threads,
  warnings = [],
  acknowledgedWarningIds = new Set(),
  onOpenChange,
  onFormChange,
  onToggleWarning,
  onSubmit,
  busy,
}: {
  readonly open: boolean;
  readonly editing: boolean;
  readonly form: AutomationFormState;
  readonly projects: ReturnType<typeof useStore.getState>["projects"];
  readonly threads: ReturnType<typeof useStore.getState>["threads"];
  readonly warnings?: readonly AutomationDraftWarning[];
  readonly acknowledgedWarningIds?: ReadonlySet<AutomationDraftWarningId>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onFormChange: (form: AutomationFormState) => void;
  readonly onToggleWarning?: (id: AutomationDraftWarningId, checked: boolean) => void;
  readonly onSubmit: () => void;
  readonly busy: boolean;
}) {
  const setField: SetAutomationFormField = (key, value) => onFormChange({ ...form, [key]: value });
  const fastIntervalLimitMessage = automationFastIntervalLimitMessage(form);
  const hasBlockingWarning = hasBlockingAutomationDraftWarnings(warnings, acknowledgedWarningIds);
  const submittable = isFormSubmittable(form) && !hasBlockingWarning;

  const chooseProject = (projectId: string) => {
    const targetStillMatches =
      form.targetThreadId.length > 0 &&
      threads.some((thread) => thread.id === form.targetThreadId && thread.projectId === projectId);
    onFormChange({
      ...form,
      projectId,
      modelSelection: modelSelectionForProjectChange(
        projects,
        form.projectId,
        projectId,
        form.modelSelection,
      ),
      targetThreadId: targetStillMatches ? form.targetThreadId : "",
    });
  };
  const applyTemplate = (template: (typeof AUTOMATION_TEMPLATES)[number]) =>
    onFormChange({
      ...form,
      name: form.name.trim() ? form.name : template.name,
      prompt: template.prompt,
    });
  const submit = () => {
    if (!busy && submittable) {
      onSubmit();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy || nextOpen) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup surface="solid" showCloseButton={false} className="max-w-3xl">
        <DialogTitle className="sr-only">
          {editing ? "Edit automation" : "New automation"}
        </DialogTitle>

        <div className="flex items-start gap-3 px-5 pt-5">
          <input
            value={form.name}
            onChange={(event) => setField("name", event.target.value)}
            placeholder="Automation title"
            aria-label="Automation title"
            autoFocus
            className="min-w-0 flex-1 bg-transparent py-1 font-system-ui text-lg font-medium text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="About automations"
              title="Automations run this prompt on a schedule and open the result as a thread."
            >
              <CentralIcon name="info-simple" className="size-4" />
            </Button>
            <Menu>
              <MenuTrigger render={<Button variant="outline" size="sm" />}>
                Use template
              </MenuTrigger>
              <ComposerPickerMenuPopup align="end" className="w-52">
                {AUTOMATION_TEMPLATES.map((template) => (
                  <MenuItem key={template.label} onClick={() => applyTemplate(template)}>
                    {template.label}
                  </MenuItem>
                ))}
              </ComposerPickerMenuPopup>
            </Menu>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              <CentralIcon name="cross-small" className="size-4" />
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-3">
          <textarea
            value={form.prompt}
            onChange={(event) => setField("prompt", event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Add prompt e.g. look for crashes in $sentry"
            aria-label="Automation prompt"
            className="min-h-[15rem] w-full flex-1 resize-none overflow-y-auto bg-transparent font-system-ui text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
          />

          {warnings.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1.5 border-t border-border/50 pt-3">
              {warnings.map((warning) => (
                <label
                  key={warning.id}
                  className="flex items-start gap-2 text-xs text-muted-foreground"
                >
                  {warning.requiresAcknowledgement ? (
                    <input
                      type="checkbox"
                      checked={acknowledgedWarningIds.has(warning.id)}
                      onChange={(event) => onToggleWarning?.(warning.id, event.target.checked)}
                      className="mt-0.5"
                    />
                  ) : (
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-500" />
                  )}
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">{warning.title}</span>
                    <span className="block">{warning.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {fastIntervalLimitMessage ? (
            <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
              {fastIntervalLimitMessage}
            </div>
          ) : null}
        </div>

        <AutomationDialogToolbar
          form={form}
          projects={projects}
          threads={threads}
          editing={editing}
          busy={busy}
          submittable={submittable}
          onFormChange={onFormChange}
          onChooseProject={chooseProject}
          onOpenChange={onOpenChange}
          onSubmit={submit}
          setField={setField}
        />
      </DialogPopup>
    </Dialog>
  );
}
