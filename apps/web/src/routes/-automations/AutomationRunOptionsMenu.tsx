// FILE: AutomationRunOptionsMenu.tsx
// Purpose: Renders heartbeat mode, target, stop, and iteration controls.
// Layer: Automation dialog

import type { AutomationMode } from "@agent-group/contracts";
import { ComposerPickerMenuPopup } from "~/components/chat/ComposerPickerMenuPopup";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import type { AutomationFormState } from "~/lib/automationForm";
import { SkillCubeIcon } from "~/lib/icons";
import { useStore } from "~/store";
import { resolveThreadPickerTitle } from "../-chatThreadRoute.logic";
import { maxIterationOptions } from "./automationCadence";
import type { SetAutomationFormField } from "./automationDialogTypes";

export function AutomationRunOptionsMenu({
  form,
  threads,
  setField,
}: {
  form: AutomationFormState;
  threads: ReturnType<typeof useStore.getState>["threads"];
  setField: SetAutomationFormField;
}) {
  const projectThreads = threads.filter((thread) => thread.projectId === form.projectId);
  const maxIterationPresets = maxIterationOptions(form.maxIterations);

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Run mode"
            title="Run mode"
            className="rounded-lg text-[var(--color-text-foreground-secondary)]"
          />
        }
      >
        <SkillCubeIcon className="size-4" />
      </MenuTrigger>
      <ComposerPickerMenuPopup align="start" className="w-56">
        <MenuGroup>
          <MenuGroupLabel>Mode</MenuGroupLabel>
          <MenuRadioGroup
            value={form.mode}
            onValueChange={(value) => setField("mode", value as AutomationMode)}
          >
            <MenuRadioItem value="standalone">Standalone</MenuRadioItem>
            <MenuRadioItem value="heartbeat">Heartbeat</MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
        {form.mode === "heartbeat" ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Target thread</MenuGroupLabel>
              {projectThreads.length === 0 ? (
                <MenuItem disabled>No threads in this project</MenuItem>
              ) : (
                <MenuRadioGroup
                  value={form.targetThreadId}
                  onValueChange={(value) => setField("targetThreadId", value)}
                >
                  {projectThreads.map((thread) => (
                    <MenuRadioItem key={thread.id} value={thread.id}>
                      <span className="truncate">{resolveThreadPickerTitle(thread.title)}</span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              )}
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Stop when</MenuGroupLabel>
              <div className="px-2 py-1">
                <input
                  value={form.stopWhen}
                  onChange={(event) => setField("stopWhen", event.target.value)}
                  placeholder="PR is ready to merge"
                  className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </MenuGroup>
            <MenuSeparator />
            <MenuCheckboxItem
              checked={form.stopOnError}
              onCheckedChange={(checked) => setField("stopOnError", checked)}
            >
              Stop on error
            </MenuCheckboxItem>
          </>
        ) : null}
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Max iterations</MenuGroupLabel>
          <MenuRadioGroup
            value={form.maxIterations}
            onValueChange={(value) => setField("maxIterations", value)}
          >
            {maxIterationPresets.map((preset) => (
              <MenuRadioItem key={preset.value || "unlimited"} value={preset.value}>
                {preset.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}
