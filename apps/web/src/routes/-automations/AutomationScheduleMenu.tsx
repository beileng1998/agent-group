// FILE: AutomationScheduleMenu.tsx
// Purpose: Renders and updates the automation schedule controls.
// Layer: Automation dialog

import {
  ComposerPickerMenuPopup,
  ComposerPickerMenuSubPopup,
} from "~/components/chat/ComposerPickerMenuPopup";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { TimePicker } from "~/components/ui/time-picker";
import {
  formatCadence,
  scheduleFromForm,
  SCHEDULE_KIND_OPTIONS,
  weekdayLabel,
  type AutomationFormState,
  type ScheduleKind,
} from "~/lib/automationForm";
import { CentralIcon } from "~/lib/central-icons";
import {
  AUTOMATION_CHIP_CLASS,
  INTERVAL_PRESETS,
  intervalOptionLabel,
  intervalOptionValue,
} from "./automationCadence";
import type { SetAutomationFormField } from "./automationDialogTypes";

export function AutomationScheduleMenu({
  form,
  onFormChange,
  setField,
}: {
  form: AutomationFormState;
  onFormChange: (form: AutomationFormState) => void;
  setField: SetAutomationFormField;
}) {
  const schedule = scheduleFromForm(form);
  const intervalValue = intervalOptionValue({
    amount: form.intervalAmount,
    unit: form.intervalUnit,
  });
  const intervalPresets = INTERVAL_PRESETS.some(
    (preset) => intervalOptionValue(preset) === intervalValue,
  )
    ? INTERVAL_PRESETS
    : [
        {
          amount: form.intervalAmount,
          unit: form.intervalUnit,
          label: intervalOptionLabel(form.intervalAmount, form.intervalUnit),
        },
        ...INTERVAL_PRESETS,
      ];

  return (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" size="sm" className={AUTOMATION_CHIP_CLASS} />}>
        <CentralIcon name="clock" className="size-4" />
        <span>{formatCadence(schedule)}</span>
        <CentralIcon name="chevron-down-small" className="size-3.5 opacity-60" />
      </MenuTrigger>
      <ComposerPickerMenuPopup align="start" className="w-56">
        <MenuGroup>
          <MenuGroupLabel>Schedule</MenuGroupLabel>
          <MenuRadioGroup
            value={form.scheduleKind}
            onValueChange={(value) => setField("scheduleKind", value as ScheduleKind)}
          >
            {SCHEDULE_KIND_OPTIONS.map((option) => (
              <MenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        {form.scheduleKind === "custom" ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Every</MenuGroupLabel>
              <MenuRadioGroup
                value={intervalValue}
                onValueChange={(value) => {
                  const [unit, amount] = value.split(":");
                  if (unit === "seconds" || unit === "minutes") {
                    onFormChange({
                      ...form,
                      intervalUnit: unit,
                      intervalAmount: amount ?? "1",
                    });
                  }
                }}
              >
                {intervalPresets.map((preset) => (
                  <MenuRadioItem
                    key={intervalOptionValue(preset)}
                    value={intervalOptionValue(preset)}
                  >
                    {preset.label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </>
        ) : null}
        {form.scheduleKind === "once" ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Run at</MenuGroupLabel>
              <div className="px-2 py-1">
                <input
                  type="datetime-local"
                  step={1}
                  value={form.onceRunAt}
                  onChange={(event) => setField("onceRunAt", event.target.value)}
                  className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </MenuGroup>
          </>
        ) : null}
        {form.scheduleKind === "cron" ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Cron</MenuGroupLabel>
              <div className="px-2 py-1">
                <input
                  value={form.cronExpression}
                  onChange={(event) => setField("cronExpression", event.target.value)}
                  placeholder="0 9 * * *"
                  className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </MenuGroup>
          </>
        ) : null}
        {form.scheduleKind === "weekly" ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Day</MenuGroupLabel>
              <MenuRadioGroup
                value={form.dayOfWeek}
                onValueChange={(value) => setField("dayOfWeek", value)}
              >
                {[0, 1, 2, 3, 4, 5, 6].map((value) => (
                  <MenuRadioItem key={value} value={String(value)}>
                    {weekdayLabel(value)}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </>
        ) : null}
        {form.scheduleKind === "daily" ||
        form.scheduleKind === "weekdays" ||
        form.scheduleKind === "weekly" ? (
          <>
            <MenuSeparator />
            <MenuSub>
              <MenuSubTrigger>
                Time
                <span className="ml-auto pr-1 tabular-nums text-muted-foreground">
                  {form.timeOfDay}
                </span>
              </MenuSubTrigger>
              <ComposerPickerMenuSubPopup>
                <div className="p-1">
                  <TimePicker
                    className="w-44"
                    value={form.timeOfDay}
                    onChange={(value) => setField("timeOfDay", value)}
                  />
                </div>
              </ComposerPickerMenuSubPopup>
            </MenuSub>
          </>
        ) : null}
        {form.scheduleKind === "daily" ||
        form.scheduleKind === "weekdays" ||
        form.scheduleKind === "weekly" ||
        form.scheduleKind === "cron" ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Timezone</MenuGroupLabel>
              <div className="px-2 py-1">
                <input
                  value={form.timezone}
                  onChange={(event) => setField("timezone", event.target.value)}
                  placeholder="Europe/Rome"
                  className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </MenuGroup>
          </>
        ) : null}
      </ComposerPickerMenuPopup>
    </Menu>
  );
}
