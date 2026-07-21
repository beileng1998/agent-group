// FILE: AutomationDialogToolbar.tsx
// Purpose: Composes automation project, model, schedule, run, and permission controls.
// Layer: Automation dialog

import type { AutomationWorktreeMode, RuntimeMode } from "@agent-group/contracts";
import { ComposerPickerMenuPopup } from "~/components/chat/ComposerPickerMenuPopup";
import { Button } from "~/components/ui/button";
import { Menu, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "~/components/ui/menu";
import type { AutomationFormState } from "~/lib/automationForm";
import { CentralIcon } from "~/lib/central-icons";
import { WorktreeIcon } from "~/lib/icons";
import { useStore } from "~/store";
import { AutomationModelPicker } from "./AutomationModelPicker";
import { AutomationRunOptionsMenu } from "./AutomationRunOptionsMenu";
import { AutomationScheduleMenu } from "./AutomationScheduleMenu";
import { AUTOMATION_CHIP_CLASS } from "./automationCadence";
import type { SetAutomationFormField } from "./automationDialogTypes";

export function AutomationDialogToolbar({
  form,
  projects,
  threads,
  editing,
  busy,
  submittable,
  onFormChange,
  onChooseProject,
  onOpenChange,
  onSubmit,
  setField,
}: {
  form: AutomationFormState;
  projects: ReturnType<typeof useStore.getState>["projects"];
  threads: ReturnType<typeof useStore.getState>["threads"];
  editing: boolean;
  busy: boolean;
  submittable: boolean;
  onFormChange: (form: AutomationFormState) => void;
  onChooseProject: (projectId: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  setField: SetAutomationFormField;
}) {
  const selectedProject = projects.find((project) => project.id === form.projectId);

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-4 pt-1">
      <div className="flex flex-1 flex-wrap items-center gap-0.5">
        {form.mode === "standalone" ? (
          <Menu>
            <MenuTrigger
              render={<Button variant="ghost" size="sm" className={AUTOMATION_CHIP_CLASS} />}
            >
              <WorktreeIcon className="size-4" />
              <span className="capitalize">{form.worktreeMode}</span>
              <CentralIcon name="chevron-down-small" className="size-3.5 opacity-60" />
            </MenuTrigger>
            <ComposerPickerMenuPopup align="start" className="w-40">
              <MenuRadioGroup
                value={form.worktreeMode}
                onValueChange={(value) => setField("worktreeMode", value as AutomationWorktreeMode)}
              >
                {(["auto", "worktree", "local"] as const).map((value) => (
                  <MenuRadioItem key={value} value={value}>
                    <span className="capitalize">{value}</span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </ComposerPickerMenuPopup>
          </Menu>
        ) : null}

        <Menu>
          <MenuTrigger
            render={<Button variant="ghost" size="sm" className={AUTOMATION_CHIP_CLASS} />}
          >
            <CentralIcon name="folder-2" className="size-4" />
            <span className="max-w-[10rem] truncate">
              {selectedProject?.name ?? "Select project"}
            </span>
            <CentralIcon name="chevron-down-small" className="size-3.5 opacity-60" />
          </MenuTrigger>
          <ComposerPickerMenuPopup align="start" className="w-56">
            <MenuRadioGroup value={form.projectId} onValueChange={onChooseProject}>
              {projects.map((project) => (
                <MenuRadioItem key={project.id} value={project.id}>
                  <span className="truncate">{project.name}</span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </ComposerPickerMenuPopup>
        </Menu>

        <AutomationModelPicker
          value={form.modelSelection}
          projectCwd={selectedProject?.cwd ?? null}
          onChange={(value) => setField("modelSelection", value)}
        />
        <AutomationScheduleMenu form={form} onFormChange={onFormChange} setField={setField} />
        <AutomationRunOptionsMenu form={form} threads={threads} setField={setField} />

        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Permissions"
                title="Permissions"
                className="rounded-lg text-[var(--color-text-foreground-secondary)]"
              />
            }
          >
            <CentralIcon name="brain" className="size-4" />
          </MenuTrigger>
          <ComposerPickerMenuPopup align="start" className="w-48">
            <MenuRadioGroup
              value={form.runtimeMode}
              onValueChange={(value) => setField("runtimeMode", value as RuntimeMode)}
            >
              <MenuRadioItem value="approval-required">Approval required</MenuRadioItem>
              <MenuRadioItem value="full-access">Full access</MenuRadioItem>
            </MenuRadioGroup>
          </ComposerPickerMenuPopup>
        </Menu>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="button" onClick={onSubmit} disabled={busy || !submittable}>
          {editing ? "Save" : "Create"}
        </Button>
      </div>
    </div>
  );
}
